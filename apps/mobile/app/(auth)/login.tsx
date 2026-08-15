import { useState } from "react";
import { KeyboardAvoidingView, View } from "react-native";
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
import { useAuthStore } from "@/data/auth-store";
import { api } from "@/data/api";
import {
  getDisplayBaseUrl,
  hasCustomApiBaseUrl,
  resetApiBaseUrl,
} from "@/data/server-config";
import { mapAuthError } from "@/lib/auth-error";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";

export default function Login() {
  const { t } = useTranslation();
  const sendCode = useAuthStore((s) => s.sendCode);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [serverOpen, setServerOpen] = useState(false);
  const [serverInput, setServerInput] = useState("");
  const [serverSaving, setServerSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverSaved, setServerSaved] = useState(false);

  const onSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    void Haptics.selectionAsync();
    setSubmitting(true);
    setError(null);
    try {
      await sendCode(trimmed);
      router.push({ pathname: "/verify", params: { email: trimmed } });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(mapAuthError(err, t("login.sendCodeError"), t));
    } finally {
      setSubmitting(false);
    }
  };

  const currentServer = getDisplayBaseUrl();

  const onSaveServer = async () => {
    void Haptics.selectionAsync();
    setServerSaving(true);
    setServerError(null);
    setServerSaved(false);
    try {
      await api.setBaseUrl(serverInput);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setServerInput("");
      setServerSaved(true);
    } catch (err) {
      setServerError(
        err instanceof Error
          ? err.message
          : t("login.serverInvalid"),
      );
    } finally {
      setServerSaving(false);
    }
  };

  const onResetServer = async () => {
    void Haptics.selectionAsync();
    setServerInput("");
    setServerError(null);
    setServerSaved(false);
    await resetApiBaseUrl();
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={keyboardBehavior}
      >
        <View className="flex-1 justify-center px-6 gap-6">
          <View className="items-center gap-3">
            <MulticaLogo size={32} />
            <View className="gap-1 items-center">
              <Text className="text-2xl font-semibold text-foreground">
                {t("login.title")}
              </Text>
              <Text className="text-sm text-muted-foreground text-center">
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
              editable={!submitting}
              invalid={!!error}
            />
            {error ? (
              <Text className="text-sm text-destructive">{error}</Text>
            ) : null}
          </View>

          <Button
            size="lg"
            disabled={submitting || !email.trim()}
            onPress={onSubmit}
          >
            <Text>{submitting ? t("login.sending") : t("login.sendCode")}</Text>
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
                className="flex-row items-center justify-between active:opacity-70"
              >
                <Text className="text-xs font-medium text-muted-foreground">
                  {t("login.server")}
                </Text>
                <View className="flex-row items-center gap-2 flex-1 justify-end">
                  {currentServer ? (
                    <Text
                      className="text-xs text-muted-foreground max-w-[70%]"
                      numberOfLines={1}
                    >
                      {currentServer}
                    </Text>
                  ) : null}
                  <Ionicons
                    name={serverOpen ? "chevron-up" : "chevron-down"}
                    size={14}
                    color="#71717a"
                  />
                </View>
              </View>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <View className="mt-3 gap-2">
                {hasCustomApiBaseUrl() ? (
                  <Text className="text-xs text-muted-foreground">
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
                  editable={!serverSaving}
                  invalid={!!serverError}
                />
                {serverError ? (
                  <Text className="text-sm text-destructive">{serverError}</Text>
                ) : null}
                {serverSaved ? (
                  <Text className="text-sm text-foreground">
                    {t("login.serverUpdated")}
                  </Text>
                ) : null}
                <View className="flex-row gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={serverSaving || !serverInput.trim()}
                    onPress={onSaveServer}
                  >
                    <Text>{serverSaving ? t("common.saving") : t("common.save")}</Text>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    disabled={serverSaving || !hasCustomApiBaseUrl()}
                    onPress={onResetServer}
                  >
                    <Text>{t("common.reset")}</Text>
                  </Button>
                </View>
              </View>
            </CollapsibleContent>
          </Collapsible>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
