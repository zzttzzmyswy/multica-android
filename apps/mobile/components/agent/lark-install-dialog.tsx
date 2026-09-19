/**
 * Lark device-flow bind dialog (iteration 170) — the mobile counterpart of
 * web's `LarkInstallDialog` (packages/views/settings/components/
 * lark-tab.tsx:642-945), reached from an agent's Integrations screen.
 *
 * The flow is: `begin` opens a registration session against the cloud the
 * user picked (accounts.feishu.cn vs accounts.larksuite.com) and returns a
 * URL; the user authorizes in Lark; the dialog polls `status` until it turns
 * success or error.
 *
 * One deliberate difference from web: web renders the URL as a QR code,
 * because the phone doing the scanning is a *different* device from the
 * browser showing it. Here the app IS the phone, and scanning your own
 * screen is not possible — so the primary actions are "Open in Lark" (the
 * device-flow URL is a universal link, so tapping it hands off to the
 * installed Lark/Feishu app) and "Copy link" (for handing the URL to another
 * device). No QR renderer, and no new native dependency to carry one.
 *
 * Session state is local rather than a TanStack query: it is a one-shot flow
 * whose whole state collapses on close, and `useQuery`'s refetch heuristics
 * (window focus, retries) are the wrong shape for a bounded poll (web makes
 * the same call — lark-tab.tsx:674-681).
 */
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/data/api";
import { larkKeys } from "@/data/queries/integrations";
import {
  larkPollHttpErrorKey,
  larkPollIntervalMs,
  larkPollOutcome,
} from "@/lib/integration-bind";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export type LarkRegion = "feishu" | "lark";

interface Session {
  sessionId: string;
  qrCodeUrl: string;
  pollIntervalSeconds: number;
}

export function LarkInstallDialog({
  wsId,
  agentId,
  region,
  onClose,
}: {
  wsId: string;
  agentId: string;
  region: LarkRegion;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<"pending" | "success" | "error">("pending");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [beginning, setBeginning] = useState(true);
  const [linkError, setLinkError] = useState(false);
  const [copied, setCopied] = useState(false);

  // Guards every await boundary: a promise that resolves after the dialog
  // closed must not write state onto an unmounted tree.
  const closedRef = useRef(false);
  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
    };
  }, []);

  // Retry path is explicit rather than an effect cascade: Lark's device_code
  // is single-use, so re-showing a failed session's URL would just fail again
  // at the next poll — every retry opens a fresh session (web lark-tab.tsx:
  // 700-712).
  const beginSession = async () => {
    setBeginning(true);
    setStatus("pending");
    setErrorKey(null);
    setErrorMessage(null);
    setSession(null);
    setLinkError(false);
    try {
      const res = await api.beginLarkInstall(wsId, agentId, region);
      if (closedRef.current) return;
      if (!res.session_id) {
        // A 200 whose body did not parse is not a session; saying so beats
        // rendering an empty card the user cannot act on.
        setStatus("error");
        setErrorKey("agents.integrations.larkErrorGeneric");
        return;
      }
      setSession({
        sessionId: res.session_id,
        qrCodeUrl: res.qr_code_url,
        pollIntervalSeconds: res.poll_interval_seconds,
      });
    } catch (e) {
      if (closedRef.current) return;
      setStatus("error");
      setErrorKey("agents.integrations.larkErrorGeneric");
      setErrorMessage(e instanceof Error ? e.message : String(e));
    } finally {
      if (!closedRef.current) setBeginning(false);
    }
  };

  useEffect(() => {
    void beginSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll loop. The session's own expiry ends it server-side, so there is no
  // separate client timer.
  useEffect(() => {
    if (!session || status !== "pending") return;
    const intervalMs = larkPollIntervalMs(session.pollIntervalSeconds);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await api.getLarkInstallStatus(wsId, session.sessionId);
        if (cancelled) return;
        const outcome = larkPollOutcome(res.status, res.error_reason);
        if (outcome.kind === "success") {
          setStatus("success");
          // The new row is what the card behind this dialog renders, so the
          // listing has to refetch before the dialog goes away.
          await qc.invalidateQueries({ queryKey: larkKeys.all(wsId) });
          return;
        }
        if (outcome.kind === "error") {
          setStatus("error");
          setErrorKey(outcome.errorKey);
          setErrorMessage(res.error_message ?? null);
          return;
        }
        timer = setTimeout(poll, intervalMs);
      } catch (e) {
        if (cancelled) return;
        const httpStatus = e instanceof ApiError ? e.status : 0;
        const terminalKey = larkPollHttpErrorKey(httpStatus);
        if (terminalKey) {
          setStatus("error");
          setErrorKey(terminalKey);
          setErrorMessage(e instanceof Error ? e.message : String(e));
          return;
        }
        // Transient (network blip, 5xx): keep the session alive and try
        // again — the next read either confirms pending or surfaces the
        // terminal error the server recorded.
        timer = setTimeout(poll, intervalMs);
      }
    };

    timer = setTimeout(poll, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sessionId, status]);

  const openLink = () => {
    if (!session?.qrCodeUrl) return;
    setLinkError(false);
    Linking.openURL(session.qrCodeUrl).catch(() => setLinkError(true));
  };

  const copyLink = async () => {
    if (!session?.qrCodeUrl) return;
    await Clipboard.setStringAsync(session.qrCodeUrl);
    setCopied(true);
  };

  const title = t(
    region === "lark"
      ? "agents.integrations.larkDialogTitleLark"
      : "agents.integrations.larkDialogTitleFeishu",
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="border-b border-border px-4 py-3 flex-row items-center gap-3">
          <View className="size-8 rounded-lg bg-secondary items-center justify-center">
            <Ionicons name="paper-plane" size={16} color={theme.mutedForeground} />
          </View>
          <Text className="flex-1 text-base font-semibold text-foreground">{title}</Text>
          <Pressable
            onPress={onClose}
            accessibilityLabel={t("agents.integrations.larkClose")}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={theme.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="px-4 py-5 gap-4">
          <Text className="text-xs text-muted-foreground leading-5">
            {t("agents.integrations.larkDialogDescription")}
          </Text>

          {beginning && !session ? (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" />
              <Text className="text-xs text-muted-foreground">
                {t("agents.integrations.larkStarting")}
              </Text>
            </View>
          ) : null}

          {session && status === "pending" ? (
            <>
              <Button onPress={openLink} disabled={!session.qrCodeUrl}>
                <Ionicons name="open-outline" size={14} color={theme.primaryForeground} />
                <Text>
                  {t(
                    region === "lark"
                      ? "agents.integrations.larkOpenLinkLark"
                      : "agents.integrations.larkOpenLinkFeishu",
                  )}
                </Text>
              </Button>
              <Button variant="outline" onPress={copyLink} disabled={!session.qrCodeUrl}>
                <Ionicons name="copy-outline" size={14} color={theme.primary} />
                <Text>
                  {copied
                    ? t("agents.integrations.larkLinkCopied")
                    : t("agents.integrations.larkCopyLink")}
                </Text>
              </Button>
              <View className="flex-row items-center gap-2">
                <ActivityIndicator size="small" />
                <Text className="flex-1 text-xs text-muted-foreground leading-4">
                  {t("agents.integrations.larkWaiting")}
                </Text>
              </View>
              {linkError ? (
                <Text className="text-xs text-destructive">
                  {t("agents.integrations.larkOpenLinkFailed")}
                </Text>
              ) : null}
            </>
          ) : null}

          {status === "success" ? (
            <View className="flex-row items-center gap-2">
              <Ionicons name="checkmark-circle" size={18} color={theme.success} />
              <Text className="text-sm font-medium text-foreground">
                {t("agents.integrations.larkSuccess")}
              </Text>
            </View>
          ) : null}

          {status === "error" ? (
            <View className="gap-2">
              <Text className="text-sm font-medium text-destructive">
                {t(errorKey ?? "agents.integrations.larkErrorGeneric")}
              </Text>
              {errorMessage ? (
                <Text className="text-[11px] text-muted-foreground leading-4">
                  {errorMessage}
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <View className="border-t border-border px-4 py-3 flex-row gap-2">
          {status === "error" ? (
            <>
              <Button variant="outline" className="flex-1" onPress={onClose}>
                <Text>{t("agents.integrations.larkClose")}</Text>
              </Button>
              <Button className="flex-1" onPress={beginSession} disabled={beginning}>
                <Ionicons name="refresh" size={14} color={theme.primaryForeground} />
                <Text>{t("agents.integrations.larkRetry")}</Text>
              </Button>
            </>
          ) : (
            <Button variant="outline" className="flex-1" onPress={onClose}>
              <Text>{t("agents.integrations.larkClose")}</Text>
            </Button>
          )}
        </View>
      </View>
    </Modal>
  );
}
