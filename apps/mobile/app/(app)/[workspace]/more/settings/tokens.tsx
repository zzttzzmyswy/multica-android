/**
 * API Tokens subscreen — account-level personal access tokens, mirroring web
 * `packages/views/settings/components/tokens-tab.tsx`: list (name / prefix /
 * created / last-used / expires), create (name + 30/90/365/never expiry),
 * a once-only created-token dialog (selectable token + copy + CLI login
 * command + "stored" acknowledgement gate), and a destructive revoke confirm.
 *
 * Deliberate mobile divergences (per mobile CLAUDE.md UI-may-differ):
 *  - Revoke confirm uses native `Alert.alert` instead of web's AlertDialog.
 *  - The created-token dialog is an in-page RN Modal, not a route: the full
 *    token must never enter navigation/URL state, and it lives in component
 *    memory only — closed via the gated "完成" button ("displayed once").
 *  - Expiry is a 4-chip row instead of a Select.
 */
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { PersonalAccessToken } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { tokenListOptions } from "@/data/queries/tokens";
import { useCreateToken, useRevokeToken } from "@/data/mutations/tokens";
import { formatDateOnlyShort } from "@/lib/autopilot-format";
import {
  TOKEN_EXPIRY_LABEL_KEYS,
  TOKEN_EXPIRY_VALUES,
  tokenCreateRequest,
  type TokenExpiryValue,
} from "@/lib/token-form";
import { tokenRowMeta } from "@/lib/token-display";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export default function TokensSettingsScreen() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    tokenListOptions(),
  );

  const createToken = useCreateToken();
  const revokeToken = useRevokeToken();

  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<TokenExpiryValue>("90");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [storedConfirmed, setStoredConfirmed] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const c = copyTimer.current;
    const cm = commandTimer.current;
    return () => {
      if (c) clearTimeout(c);
      if (cm) clearTimeout(cm);
    };
  }, []);

  const flashCopied = (
    ref: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    set: (v: boolean) => void,
  ) => {
    set(true);
    if (ref.current) clearTimeout(ref.current);
    ref.current = setTimeout(() => set(false), 2000);
  };

  const onCreate = () => {
    const trimmed = name.trim();
    if (!trimmed || createToken.isPending) return;
    createToken.mutate(tokenCreateRequest(trimmed, expiry), {
      onSuccess: (res) => {
        if (!res.token) {
          // Drift fallback produced a blank token — never open an empty
          // dialog; surface the failure instead.
          Alert.alert(t("tokens.createFailedTitle"));
          return;
        }
        setNewToken(res.token);
        setStoredConfirmed(false);
        setName("");
        setExpiry("90");
      },
      onError: (err) =>
        Alert.alert(
          t("tokens.createFailedTitle"),
          err instanceof Error ? err.message : t("common.unknownError"),
        ),
    });
  };

  const onRevoke = (token: PersonalAccessToken) => {
    Alert.alert(
      t("tokens.revokeConfirmTitle"),
      t("tokens.revokeConfirmMessage"),
      [
        { text: t("tokens.revokeCancel"), style: "cancel" },
        {
          text: t("tokens.revoke"),
          style: "destructive",
          onPress: () => {
            setRevokingId(token.id);
            revokeToken.mutate(token.id, {
              onSettled: () => setRevokingId(null),
              onSuccess: () => Alert.alert(t("tokens.revokedTitle")),
              onError: (err) =>
                Alert.alert(
                  t("tokens.revokeFailedTitle"),
                  err instanceof Error ? err.message : t("common.unknownError"),
                ),
            });
          },
        },
      ],
    );
  };

  const copyToken = async () => {
    if (!newToken) return;
    if (await Clipboard.setStringAsync(newToken)) {
      flashCopied(copyTimer, setTokenCopied);
    }
  };

  const copyCommand = async () => {
    if (!newToken) return;
    if (await Clipboard.setStringAsync(`multica login --token ${newToken}`)) {
      flashCopied(commandTimer, setCommandCopied);
    }
  };

  const closeCreated = () => {
    setNewToken(null);
    setStoredConfirmed(false);
    setTokenCopied(false);
    setCommandCopied(false);
  };

  const metaLabels = {
    fmtDate: formatDateOnlyShort,
    created: (d: string) => t("tokens.createdWithDate", { date: d }),
    lastUsedWithDate: (d: string) =>
      t("tokens.lastUsedWithDate", { date: d }),
    lastUsedNever: t("tokens.lastUsedNever"),
    expiresWithDate: (d: string) => t("tokens.expiresWithDate", { date: d }),
  };

  const tokens = data ?? [];
  const showEmpty = !isLoading && !error && tokens.length === 0;

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-5"
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
      }
    >
      <View className="gap-1.5">
        <Text className="text-sm text-muted-foreground">
          {t("tokens.description")}
        </Text>
        <Text className="text-xs text-muted-foreground/70">
          {t("tokens.securityNote")}
        </Text>
      </View>

      {/* Create card */}
      <View className="rounded-md border border-border bg-card p-3 gap-3">
        <TextField
          value={name}
          onChangeText={setName}
          placeholder={t("tokens.namePlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t("tokens.namePlaceholder")}
        />
        <View className="flex-row gap-2">
          {TOKEN_EXPIRY_VALUES.map((value) => {
            const selected = expiry === value;
            return (
              <Pressable
                key={value}
                onPress={() => setExpiry(value)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={t(TOKEN_EXPIRY_LABEL_KEYS[value])}
                className={cn(
                  "flex-1 items-center justify-center rounded-md px-2 py-2",
                  selected ? "bg-primary" : "bg-secondary",
                )}
              >
                <Text
                  className={cn(
                    "text-xs font-medium",
                    selected ? "text-primary-foreground" : "text-foreground",
                  )}
                >
                  {t(TOKEN_EXPIRY_LABEL_KEYS[value])}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Button
          onPress={onCreate}
          disabled={createToken.isPending || !name.trim()}
        >
          <Text>
            {createToken.isPending ? t("tokens.creating") : t("tokens.create")}
          </Text>
        </Button>
      </View>

      {/* List */}
      {isLoading ? (
        <View className="gap-2">
          <Skeleton className="h-16 rounded-md" />
          <Skeleton className="h-16 rounded-md" />
        </View>
      ) : error ? (
        <View className="gap-3 pt-2">
          <Text className="text-sm text-destructive">
            {t("tokens.loadFailed")}
            {error instanceof Error ? ` — ${error.message}` : ""}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>{t("workspace.retry")}</Text>
          </Button>
        </View>
      ) : showEmpty ? (
        <View className="rounded-md border border-border bg-card py-10 px-6 items-center gap-2">
          <Ionicons name="key-outline" size={28} color={theme.mutedForeground} />
          <Text className="text-sm text-muted-foreground text-center">
            {t("tokens.empty")}
          </Text>
        </View>
      ) : (
        <View className="rounded-md border border-border bg-card overflow-hidden">
          {tokens.map((token, idx) => (
            <View key={token.id}>
              {idx > 0 ? <Separator className="ml-4" /> : null}
              <TokenRow
                token={token}
                meta={tokenRowMeta(token, metaLabels)}
                revoking={revokingId === token.id}
                onRevoke={() => onRevoke(token)}
                theme={theme}
              />
            </View>
          ))}
        </View>
      )}

      {/* Created-token dialog — in-page Modal so the one-shot token never
          enters navigation state and is visible exactly once; closable only
          via the gated Done button (Android back / backdrop are no-ops). */}
      <Modal
        visible={!!newToken}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View className="flex-1 bg-black/40 items-center justify-center px-6">
          <View className="w-full max-w-sm bg-popover rounded-2xl p-4 gap-3">
            <Text className="text-base font-semibold text-foreground">
              {t("tokens.createdTitle")}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t("tokens.createdWarningPrefix")}
              <Text className="font-medium text-foreground">
                {t("tokens.createdWarningEmphasis")}
              </Text>
              {t("tokens.createdWarningSuffix")}
            </Text>

            <View className="flex-row items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
              <Text
                selectable
                className="flex-1 font-mono text-xs text-foreground"
              >
                {newToken}
              </Text>
              <Pressable
                onPress={copyToken}
                accessibilityLabel={t("tokens.createdCopyToken")}
                hitSlop={8}
              >
                <Ionicons
                  name={tokenCopied ? "checkmark" : "copy-outline"}
                  size={18}
                  color={tokenCopied ? theme.primary : theme.mutedForeground}
                />
              </Pressable>
            </View>

            <View className="gap-1.5">
              <Text className="text-xs text-muted-foreground">
                {t("tokens.createdCliHint")}
              </Text>
              <View className="flex-row items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
                <Text
                  selectable
                  className="flex-1 font-mono text-xs text-foreground"
                >
                  {`multica login --token ${newToken}`}
                </Text>
                <Pressable
                  onPress={copyCommand}
                  accessibilityLabel={t("tokens.createdCopyCommand")}
                  hitSlop={8}
                >
                  <Ionicons
                    name={commandCopied ? "checkmark" : "copy-outline"}
                    size={18}
                    color={commandCopied ? theme.primary : theme.mutedForeground}
                  />
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={() => setStoredConfirmed((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: storedConfirmed }}
              className="flex-row items-center gap-2 py-1"
            >
              <Ionicons
                name={storedConfirmed ? "checkbox" : "square-outline"}
                size={20}
                color={storedConfirmed ? theme.primary : theme.mutedForeground}
              />
              <Text className="flex-1 text-sm text-foreground">
                {t("tokens.createdConfirmStored")}
              </Text>
            </Pressable>

            <Button disabled={!storedConfirmed} onPress={closeCreated}>
              <Text>{t("tokens.createdDone")}</Text>
            </Button>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function TokenRow({
  token,
  meta,
  revoking,
  onRevoke,
  theme,
}: {
  token: PersonalAccessToken;
  meta: string;
  revoking: boolean;
  onRevoke: () => void;
  theme: (typeof THEME)[keyof typeof THEME];
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center gap-3 px-4 py-3">
      <View className="flex-1 min-w-0">
        <Text
          className="text-base font-medium text-foreground"
          numberOfLines={1}
        >
          {token.name}
        </Text>
        <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={2}>
          {meta}
        </Text>
      </View>
      <Pressable
        onPress={onRevoke}
        disabled={revoking}
        accessibilityLabel={t("tokens.revokeAria", { name: token.name })}
        hitSlop={8}
        className="p-1.5"
      >
        {revoking ? (
          <ActivityIndicator size="small" />
        ) : (
          <Ionicons
            name="trash-outline"
            size={18}
            color={theme.destructive}
          />
        )}
      </Pressable>
    </View>
  );
}