import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Text } from "@/components/ui/text";
import { OtpInput, type OtpInputRef } from "@/components/ui/otp-input";
import { Button } from "@/components/ui/button";
import { MulticaLogo } from "@/components/brand/multica-logo";
import { ServerUnreachableNotice } from "@/components/ui/server-unreachable-notice";
import { useAuthStore } from "@/data/auth-store";
import {
  getDisplayBaseUrl,
  getServerResetTarget,
  hasCustomApiBaseUrl,
  resetApiBaseUrl,
} from "@/data/server-config";
import { classifyError, isConnectionError, mapAuthError } from "@/lib/auth-error";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

export default function Verify() {
  const { t } = useTranslation();
  const sendCode = useAuthStore((s) => s.sendCode);
  const verifyCode = useAuthStore((s) => s.verifyCode);
  const { email = "" } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resending, setResending] = useState(false);
  const otpRef = useRef<OtpInputRef>(null);
  const actionPending = useRef(false);
  const [switching, setSwitching] = useState(false);
  const busy = submitting || resending || switching;
  // Set when a request failed on an unreachable custom server — see the
  // login screen, which carries the same recovery affordance.
  const [failedServer, setFailedServer] = useState<string | null>(null);

  /** Record the unreachable-override case so the recovery notice can render
   *  next to whatever error the caller just set. */
  const noteConnectionFailure = (err: unknown, serverAtSubmit: string | null) => {
    if (isConnectionError(err) && serverAtSubmit === getDisplayBaseUrl()) {
      setFailedServer(serverAtSubmit);
    }
  };

  const onResetServer = async (expected: string) => {
    if (actionPending.current || !getServerResetTarget(expected)) return;
    actionPending.current = true;
    setSwitching(true);
    try {
      // The OTP was issued by the old server. Back to login before requesting
      // a new code; never send the old code or email to the new host implicitly.
      if (await resetApiBaseUrl(expected)) router.back();
    } catch {
      setError(t("login.serverResetFailed"));
    } finally {
      actionPending.current = false;
      setSwitching(false);
    }
  };

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const submit = async (value: string) => {
    if (value.length !== CODE_LENGTH || !email || actionPending.current) return;
    const serverAtSubmit = hasCustomApiBaseUrl() ? getDisplayBaseUrl() : null;
    actionPending.current = true;
    void Haptics.selectionAsync();
    setSubmitting(true);
    setError(null);
    setFailedServer(null);
    try {
      await verifyCode(email, value);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/");
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, t("verify.codeError"), t));
      noteConnectionFailure(err, serverAtSubmit);
      const kind = classifyError(err);
      if (kind !== "offline" && kind !== "server") {
        otpRef.current?.clear();
        setCode("");
      }
    } finally {
      actionPending.current = false;
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    if (cooldown > 0 || actionPending.current || !email) return;
    const serverAtSubmit = hasCustomApiBaseUrl() ? getDisplayBaseUrl() : null;
    actionPending.current = true;
    void Haptics.selectionAsync();
    setResending(true);
    setError(null);
    setFailedServer(null);
    try {
      await sendCode(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      otpRef.current?.clear();
      setCode("");
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, t("verify.resendError"), t));
      noteConnectionFailure(err, serverAtSubmit);
    } finally {
      actionPending.current = false;
      setResending(false);
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
          contentContainerClassName="grow justify-center px-6 py-5 gap-6"
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center gap-3">
            <MulticaLogo size={32} />
            <View className="gap-1 items-center">
              <Text className="text-display-sm font-semibold text-foreground">
                {t("verify.title")}
              </Text>
              <Text className="text-body text-muted-foreground text-center">
                {t("verify.subtitle", { email })}
              </Text>
            </View>
          </View>

          <View className="gap-3 items-center">
            <OtpInput
              ref={otpRef}
              numberOfDigits={CODE_LENGTH}
              value={code}
              onChange={setCode}
              onComplete={submit}
              autoFocus
              editable={!busy}
            />
            {error ? (
              <Text accessibilityLiveRegion="polite" className="text-body text-destructive">{error}</Text>
            ) : null}
            {error && failedServer && failedServer === getDisplayBaseUrl() ? (
              <ServerUnreachableNotice
                failedBaseUrl={failedServer}
                defaultUrl={getServerResetTarget(failedServer)}
                switching={switching}
                disabled={busy}
                onSwitch={() => onResetServer(failedServer)}
              />
            ) : null}
          </View>

          <View className="gap-3">
            <Button
              size="lg"
              disabled={busy || code.length < CODE_LENGTH}
              onPress={() => submit(code)}
            >
              <Text>{submitting ? t("verify.verifying") : t("verify.verify")}</Text>
            </Button>

            <Pressable
              onPress={onResend}
              disabled={cooldown > 0 || busy}
              className="min-h-12 justify-center items-center"
            >
              <Text
                className={
                  cooldown > 0 || busy
                    ? "text-body text-muted-foreground"
                    : "text-body text-primary"
                }
              >
                {resending
                  ? t("verify.sending")
                  : cooldown > 0
                    ? t("verify.resendCooldown", { count: cooldown })
                    : t("verify.resend")}
              </Text>
            </Pressable>

            <Button
              variant="ghost"
              disabled={busy}
              onPress={() => router.back()}
            >
              <Text>{t("verify.differentEmail")}</Text>
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
