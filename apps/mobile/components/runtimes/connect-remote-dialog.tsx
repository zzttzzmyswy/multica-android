/**
 * Connect-remote-machine dialog (iteration-82, A2.1). Full-screen modal
 * mirroring web `packages/views/runtimes/components/connect-remote-dialog.tsx`
 * on a phone.
 *
 * Step 1 ("instructions") shows the two terminal commands to run on the
 * target machine — install the Multica CLI, then start the daemon — each with
 * a copy button, plus a live-listening indicator and a collapsible
 * troubleshooting section (token-based sign-in + daemon status/logs). The
 * step-2 command is derived from the app's effective API base URL: a
 * self-hosted server (<any origin other than the Multica cloud>) gets the
 * explicit `--server-url/--app-url` form, otherwise the plain `multica setup`.
 *
 * The dialog then passively listens for a `daemon:register` WS event (the
 * daemon emits it on startup) and auto-advances to step 2 ("success") — the
 * same live flow as web, wired through the shared WS client. The success
 * step offers jumping to the new runtime's detail or creating an agent.
 */
import { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useWSSubscriptions } from "@/lib/use-ws-subscriptions";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { getApiBaseUrl, getWebBaseUrl } from "@/data/server-config";

const INSTALL_CMD =
  "curl -fsSL https://raw.githubusercontent.com/multica-ai/multica/main/scripts/install.sh | bash";
const CLOUD_SERVER_URL = "https://api.multica.ai";
const CLOUD_APP_URL = "https://multica.ai";

function normalizeCommandURL(url: string | undefined) {
  return url?.trim().replace(/\/+$/, "") ?? "";
}

function isMulticaCloud(base: string): boolean {
  try {
    const hostname = new URL(base).hostname;
    return (
      hostname === "api.multica.ai" ||
      hostname === "multica.ai" ||
      hostname.endsWith(".multica.ai")
    );
  } catch {
    return false;
  }
}

/** Derive the exact daemon commands from the app's effective server config —
 *  self-hosted installs get explicit URLs, the Multica cloud gets the plain
 *  command. Mirrors web's `daemonCommands(serverUrl, appUrl)`.
 */
export function daemonCommands(
  serverUrl: string | undefined,
  appUrl: string | undefined,
): { setupCmd: string; tokenCmd: string } {
  const normalizedServerUrl = normalizeCommandURL(serverUrl);
  const normalizedAppUrl = normalizeCommandURL(appUrl);
  if (normalizedServerUrl && normalizedAppUrl) {
    return {
      setupCmd: `multica setup self-host --server-url ${normalizedServerUrl} --app-url ${normalizedAppUrl}`,
      tokenCmd: `multica config set server_url ${normalizedServerUrl}
multica config set app_url ${normalizedAppUrl}
multica login --token <YOUR_TOKEN>
multica daemon start`,
    };
  }
  return {
    setupCmd: "multica setup",
    tokenCmd: `multica config set server_url ${CLOUD_SERVER_URL}
multica config set app_url ${CLOUD_APP_URL}
multica login --token <YOUR_TOKEN>
multica daemon start`,
  };
}

export function useDaemonCommands(): {
  setupCmd: string;
  tokenCmd: string;
} {
  let serverUrl: string | undefined;
  let appUrl: string | undefined;
  try {
    serverUrl = getApiBaseUrl();
  } catch {
    serverUrl = undefined;
  }
  try {
    appUrl = getWebBaseUrl();
  } catch {
    appUrl = undefined;
  }
  // For a Multica-cloud base the self-hosted flag is wrong — keep the plain
  // commands (web's cloud branch). Only non-cloud bases carry URLs through.
  if (!serverUrl || isMulticaCloud(serverUrl)) {
    return daemonCommands(undefined, undefined);
  }
  return daemonCommands(serverUrl, appUrl);
}

type Step = "instructions" | "success";

function CommandBlock({
  n,
  label,
  cmd,
  copyLabel,
}: {
  n?: number;
  label: string;
  cmd: string;
  copyLabel: string;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View className="gap-1.5">
      <Text className="text-xs font-medium text-foreground">
        {n ? `${n}. ` : ""}
        {label}
      </Text>
      <View className="flex-row items-start gap-2 rounded-lg bg-secondary px-3 py-2.5">
        <Ionicons
          name="terminal-outline"
          size={14}
          color={theme.mutedForeground}
          style={{ marginTop: 2 }}
        />
        <Text
          selectable
          className="flex-1 font-mono text-xs text-foreground"
          style={{ lineHeight: 18 }}
        >
          {cmd}
        </Text>
        <Pressable
          onPress={handleCopy}
          accessibilityLabel={copyLabel}
          hitSlop={8}
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={16}
            color={copied ? theme.success : theme.mutedForeground}
          />
        </Pressable>
      </View>
    </View>
  );
}

export function ConnectRemoteDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>("instructions");
  const newRuntimeIdRef = useRef<string | null>(null);
  const { setupCmd, tokenCmd } = useDaemonCommands();

  // Passive live listener: the first `daemon:register` event invalidates the
  // runtime list and auto-advances to the success step (web parity).
  useWSSubscriptions(
    (ws) => [
      ws.on("daemon:register", (payload) => {
        if (step !== "instructions") return;
        if (wsId) {
          qc.invalidateQueries({ queryKey: runtimeListOptions(wsId).queryKey });
        }
        const p = payload as Record<string, unknown> | null;
        if (p?.runtime_id && typeof p.runtime_id === "string") {
          newRuntimeIdRef.current = p.runtime_id;
        }
        setStep("success");
      }),
    ],
    [step, wsId, qc],
  );

  const goToAgents = () => {
    onClose();
    if (wsSlug) router.push(`/${wsSlug}/more/agents/new`);
  };

  const goToRuntime = () => {
    onClose();
    if (wsSlug && newRuntimeIdRef.current) {
      router.push(`/${wsSlug}/more/runtimes/${newRuntimeIdRef.current}`);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        {/* Header */}
        <View className="border-b border-border px-4 py-3 flex-row items-center gap-3">
          <View className="size-8 rounded-lg bg-secondary items-center justify-center">
            <Ionicons
              name="hardware-chip-outline"
              size={16}
              color={theme.mutedForeground}
            />
          </View>
          <Text className="flex-1 text-base font-semibold text-foreground">
            {step === "instructions"
              ? t("runtimes.connect.title")
              : t("runtimes.connect.successTitle")}
          </Text>
          <Pressable onPress={onClose} accessibilityLabel={t("runtimes.connect.cancel")} hitSlop={8}>
            <Ionicons name="close" size={20} color={theme.mutedForeground} />
          </Pressable>
        </View>

        {step === "instructions" ? (
          <>
            <ScrollView
              className="flex-1"
              contentContainerClassName="px-4 py-4 gap-4"
            >
              <Text className="text-xs text-muted-foreground leading-5">
                {t("runtimes.connect.description")}
              </Text>

              <CommandBlock
                n={1}
                label={t("runtimes.connect.step1Label")}
                cmd={INSTALL_CMD}
                copyLabel={t("runtimes.connect.copy")}
              />

              <View className="gap-1">
                <CommandBlock
                  n={2}
                  label={t("runtimes.connect.step2Label")}
                  cmd={setupCmd}
                  copyLabel={t("runtimes.connect.copy")}
                />
                <Text className="text-[11px] text-muted-foreground leading-4">
                  {t("runtimes.connect.step2Hint")}
                </Text>
              </View>

              {/* Live-listening indicator */}
              <View className="flex-row items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
                <View className="size-2 rounded-full bg-success" />
                <Text className="text-xs font-medium text-foreground">
                  {t("runtimes.connect.liveListening")}
                </Text>
                <Text className="flex-1 text-[11px] text-muted-foreground">
                  {t("runtimes.connect.liveListeningHint")}
                </Text>
              </View>

              <Troubleshooting tokenCmd={tokenCmd} />
            </ScrollView>

            <View className="border-t border-border px-4 py-3">
              <Button variant="outline" onPress={onClose}>
                <Text>{t("runtimes.connect.cancel")}</Text>
              </Button>
            </View>
          </>
        ) : (
          <SuccessStep
            onGoToRuntime={newRuntimeIdRef.current ? goToRuntime : undefined}
            onGoToAgents={goToAgents}
            onClose={onClose}
          />
        )}
      </View>
    </Modal>
  );
}

function Troubleshooting({ tokenCmd }: { tokenCmd: string }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [open, setOpen] = useState(false);

  return (
    <View className="rounded-lg border border-dashed border-border">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        className="flex-row items-center gap-1.5 px-3 py-2"
      >
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={14}
          color={theme.mutedForeground}
        />
        <Text className="text-xs font-medium text-muted-foreground">
          {t("runtimes.connect.troubleshooting")}
        </Text>
      </Pressable>
      {open ? (
        <View className="border-t border-border px-3 py-2.5 gap-2">
          <Text className="text-[11px] text-muted-foreground leading-4">
            {t("runtimes.connect.troubleIntro")}
          </Text>
          <CommandBlock
            label={t("runtimes.connect.step2Label")}
            cmd={tokenCmd}
            copyLabel={t("runtimes.connect.copy")}
          />
          <Text className="text-[11px] text-muted-foreground leading-4">
            {t("runtimes.connect.troubleTokenHint")}
          </Text>
          <View className="gap-1">
            <View className="flex-row items-center gap-1.5">
              <Text className="flex-1 text-[11px] text-muted-foreground">
                {t("runtimes.connect.troubleCheckStatus")}
              </Text>
              <Text className="font-mono text-[11px] text-foreground">
                multica daemon status
              </Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Text className="flex-1 text-[11px] text-muted-foreground">
                {t("runtimes.connect.troubleViewLogs")}
              </Text>
              <Text className="font-mono text-[11px] text-foreground">
                multica daemon logs -f
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SuccessStep({
  onGoToRuntime,
  onGoToAgents,
  onClose,
}: {
  onGoToRuntime?: () => void;
  onGoToAgents: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 py-8 items-center gap-3"
      >
        <View className="size-14 rounded-full bg-success/10 items-center justify-center">
          <Ionicons name="checkmark" size={28} color={theme.success} />
        </View>
        <Text className="text-base font-semibold text-foreground">
          {t("runtimes.connect.successTitle")}
        </Text>
        <Text className="text-xs text-muted-foreground text-center leading-5">
          {t("runtimes.connect.successDescription")}
        </Text>
      </ScrollView>
      <View className="border-t border-border px-4 py-3 gap-2">
        {onGoToRuntime ? (
          <Button variant="outline" onPress={onGoToRuntime}>
            <Text>{t("runtimes.connect.viewRuntime")}</Text>
          </Button>
        ) : null}
        <Button onPress={onGoToAgents}>
          <Text>{t("runtimes.connect.createAgent")}</Text>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </Button>
        <Button variant="ghost" onPress={onClose}>
          <Text className="text-muted-foreground">{t("runtimes.connect.cancel")}</Text>
        </Button>
      </View>
    </>
  );
}