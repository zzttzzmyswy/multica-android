import { useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { MulticaLogo } from "@/components/brand/multica-logo";
import { ServerUnreachableNotice } from "@/components/ui/server-unreachable-notice";
import { useAuthStore } from "@/data/auth-store";
import { api } from "@/data/api";
import {
  getDisplayBaseUrl,
  getServerResetTarget,
  hasCustomApiBaseUrl,
  normalizeServerBaseUrl,
  resetApiBaseUrl,
} from "@/data/server-config";
import { isConnectionError, mapAuthError } from "@/lib/auth-error";
import { keyboardBehavior } from "@/lib/keyboard";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";
import { useTranslation } from "@/lib/i18n/react";

export default function Login() {
  const { t } = useTranslation();
  const palette = useThemePalette();
  const sendCode = useAuthStore((s) => s.sendCode);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionPending = useRef(false);
  const [switching, setSwitching] = useState(false);

  const [serverOpen, setServerOpen] = useState(false);
  const [serverInput, setServerInput] = useState("");
  const [serverSaving, setServerSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverSaved, setServerSaved] = useState(false);
  // Server the last failed send-code request targeted, when that failure was
  // a connectivity problem and a custom override was in play. Kept so the
  // recovery notice can still name the host after a reset clears the override.
  const [failedServer, setFailedServer] = useState<string | null>(null);

  const onSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed || actionPending.current) return;
    const serverAtSubmit = hasCustomApiBaseUrl() ? getDisplayBaseUrl() : null;
    actionPending.current = true;
    void Haptics.selectionAsync();
    setSubmitting(true);
    setError(null);
    setFailedServer(null);
    try {
      await sendCode(trimmed);
      router.push({ pathname: "/verify", params: { email: trimmed } });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, t("login.sendCodeError"), t));
      if (isConnectionError(err) && serverAtSubmit === getDisplayBaseUrl()) {
        setFailedServer(serverAtSubmit);
      }
    } finally {
      actionPending.current = false;
      setSubmitting(false);
    }
  };

  const currentServer = getDisplayBaseUrl();
  const resetTarget = getServerResetTarget(currentServer);
  const busy = submitting || serverSaving || switching;

  const onSaveServer = async () => {
    if (actionPending.current) return;
    const url = normalizeServerBaseUrl(serverInput);
    if (!url) {
      setServerError(t("login.serverInvalid"));
      return;
    }
    actionPending.current = true;
    void Haptics.selectionAsync();
    setServerSaving(true);
    setServerError(null);
    setServerSaved(false);
    try {
      await api.setBaseUrl(url);
      setFailedServer(null);
      setError(null);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setServerInput("");
      setServerSaved(true);
    } catch {
      setServerError(t("login.serverSaveFailed"));
    } finally {
      actionPending.current = false;
      setServerSaving(false);
    }
  };

  const onResetServer = async (expected: string) => {
    if (actionPending.current || !getServerResetTarget(expected)) return;
    actionPending.current = true;
    setSwitching(true);
    setServerError(null);
    setServerSaved(false);
    try {
      if (await resetApiBaseUrl(expected)) {
        setServerInput("");
        setFailedServer(null);
        setError(null);
        setServerSaved(true);
      }
    } catch {
      setServerError(t("login.serverResetFailed"));
      setServerOpen(true);
    } finally {
      actionPending.current = false;
      setSwitching(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={keyboardBehavior}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="grow justify-center px-6 gap-6"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center gap-3">
            <MulticaLogo size={32} />
            <View className="gap-1 items-center">
              <Text className="text-display-sm font-semibold text-foreground">
                {t("login.title")}
              </Text>
              <Text className="text-body text-muted-foreground text-center">
                {t("login.subtitle")}
              </Text>
            </View>
          </View>

          <View className="gap-3">
            <TextField
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
              keyboardType="email-address"
              placeholder={t("login.emailPlaceholder")}
              value={email}
              onChangeText={setEmail}
              onSubmitEditing={onSubmit}
              returnKeyType="send"
              editable={!busy}
              invalid={!!error}
            />
            {error ? (
              <Text accessibilityLiveRegion="polite" className="text-body text-destructive">{error}</Text>
            ) : null}
            {error && failedServer && failedServer === currentServer ? (
              <ServerUnreachableNotice
                failedBaseUrl={failedServer}
                defaultUrl={resetTarget}
                switching={switching}
                disabled={busy}
                onSwitch={() => onResetServer(failedServer)}
                onEdit={() => setServerOpen(true)}
              />
            ) : null}
          </View>

          <Button
            size="lg"
            disabled={busy || !email.trim()}
            onPress={onSubmit}
          >
            <Text>{submitting ? t("login.sending") : t("login.sendCode")}</Text>
          </Button>

          {/* Pre-auth demo page — works fully offline with mock data. */}
          <Button variant="ghost" size="lg" onPress={() => router.push("/demo")}>
            <Text>{t("demo.login.entry")}</Text>
          </Button>

          <Collapsible
            open={serverOpen}
            onOpenChange={setServerOpen}
            className="border-t border-border pt-4"
          >
            <CollapsibleTrigger asChild>
              <View
                accessibilityRole="button"
                accessibilityState={{ expanded: serverOpen }}
                className="min-h-12 flex-row items-center gap-2 active:opacity-70"
              >
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="text-body font-medium text-foreground">
                    {t("login.server")}
                  </Text>
                  {currentServer ? (
                    <Text className="text-caption text-muted-foreground">
                      {currentServer}
                    </Text>
                  ) : null}
                </View>
                <Ionicons
                  name={serverOpen ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={palette.mutedForeground}
                />
              </View>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <View className="mt-3 gap-2">
                {hasCustomApiBaseUrl() ? (
                  <Text className="text-caption text-muted-foreground">
                    {t("login.usingCustomServer")}
                  </Text>
                ) : null}
                <TextField
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  keyboardType="url"
                  placeholder={t("login.serverPlaceholder")}
                  value={serverInput}
                  onChangeText={setServerInput}
                  editable={!busy}
                  invalid={!!serverError}
                />
                {serverError ? (
                  <Text className="text-body text-destructive">{serverError}</Text>
                ) : null}
                {serverSaved ? (
                  <Text className="text-body text-foreground">
                    {t("login.serverUpdated")}
                  </Text>
                ) : null}
                <View className="gap-2">
                  <Button
                    variant="outline"
                    className="min-h-12 h-auto py-2"
                    disabled={busy || !serverInput.trim()}
                    onPress={onSaveServer}
                  >
                    <Text>{serverSaving ? t("common.saving") : t("common.save")}</Text>
                  </Button>
                  {resetTarget ? (
                    <>
                      <Text className="text-caption text-muted-foreground">
                        {t("login.serverSwitchTarget", { url: resetTarget })}
                      </Text>
                      <Button
                        variant="ghost"
                        className="min-h-12 h-auto py-2"
                        disabled={busy}
                        onPress={() => onResetServer(currentServer)}
                      >
                        <Text>{switching ? t("login.switchingServer") : t("login.useDefaultServer")}</Text>
                      </Button>
                    </>
                  ) : null}
                </View>
              </View>
            </CollapsibleContent>
          </Collapsible>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
