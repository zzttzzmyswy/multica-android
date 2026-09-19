/**
 * Bring-your-own-app bind dialog (iteration 170) — Slack / DingTalk / WeCom.
 *
 * Web keeps one dialog per channel (slack-tab.tsx:256-470, dingtalk-tab.tsx:
 * 530-670, wecom-tab.tsx:231-470); they differ only in their field list, so
 * mobile drives all three from one component parameterised by channel. The
 * validation and the request body both come from lib/integration-bind.ts, so
 * what the form enforces and what it sends stay in one place.
 *
 * Submitting calls the channel's `register*BYO` and invalidates the listing;
 * the card behind the dialog is what renders the result, so the dialog closes
 * on success rather than trying to show the installation itself.
 */
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { ApiError } from "@/data/api";
import {
  useRegisterDingTalkBYO,
  useRegisterSlackBYO,
  useRegisterWecomBYO,
} from "@/data/mutations/channels";
import {
  byoFieldErrors,
  byoRequestBody,
  isByoSubmittable,
  type ByoChannel,
  type ByoFormValues,
} from "@/lib/integration-bind";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface FieldSpec {
  name: string;
  labelKey: string;
  placeholderKey: string;
  /** Tokens and secrets stay masked on screen. */
  secure?: boolean;
  hintKey?: string;
}

/** Field order and copy per channel, matching web's dialogs. */
const FIELDS: Record<ByoChannel, FieldSpec[]> = {
  slack: [
    {
      name: "bot_token",
      labelKey: "agents.integrations.byoSlackBotLabel",
      placeholderKey: "agents.integrations.byoSlackBotPlaceholder",
      secure: true,
      hintKey: "agents.integrations.byoSlackBotHint",
    },
    {
      name: "app_token",
      labelKey: "agents.integrations.byoSlackAppLabel",
      placeholderKey: "agents.integrations.byoSlackAppPlaceholder",
      secure: true,
      hintKey: "agents.integrations.byoSlackAppHint",
    },
  ],
  dingtalk: [
    {
      name: "client_id",
      labelKey: "agents.integrations.byoDingTalkClientIdLabel",
      placeholderKey: "agents.integrations.byoDingTalkClientIdPlaceholder",
    },
    {
      name: "client_secret",
      labelKey: "agents.integrations.byoDingTalkClientSecretLabel",
      placeholderKey: "agents.integrations.byoDingTalkClientSecretPlaceholder",
      secure: true,
    },
  ],
  wecom: [
    {
      name: "bot_id",
      labelKey: "agents.integrations.byoWecomBotIdLabel",
      placeholderKey: "agents.integrations.byoWecomBotIdPlaceholder",
    },
    {
      name: "secret",
      labelKey: "agents.integrations.byoWecomSecretLabel",
      placeholderKey: "agents.integrations.byoWecomSecretPlaceholder",
      secure: true,
    },
    {
      name: "bot_name",
      labelKey: "agents.integrations.byoWecomBotNameLabel",
      placeholderKey: "agents.integrations.byoWecomBotNamePlaceholder",
      hintKey: "agents.integrations.byoWecomBotNameHint",
    },
  ],
};

const TITLE_KEY: Record<ByoChannel, string> = {
  slack: "agents.integrations.byoSlackTitle",
  dingtalk: "agents.integrations.byoDingTalkTitle",
  wecom: "agents.integrations.byoWecomTitle",
};

const DESCRIPTION_KEY: Record<ByoChannel, string> = {
  slack: "agents.integrations.byoSlackDescription",
  dingtalk: "agents.integrations.byoDingTalkDescription",
  wecom: "agents.integrations.byoWecomDescription",
};

const SUBMIT_KEY: Record<ByoChannel, string> = {
  slack: "agents.integrations.byoSlackSubmit",
  dingtalk: "agents.integrations.byoDingTalkSubmit",
  wecom: "agents.integrations.byoWecomSubmit",
};

export function ChannelByoDialog({
  channel,
  agentId,
  onClose,
}: {
  channel: ByoChannel;
  agentId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const insets = useSafeAreaInsets();

  const [values, setValues] = useState<ByoFormValues>({});
  // Errors only appear once the admin has tried to submit: flagging an empty
  // field they have not reached yet is noise, not help.
  const [showErrors, setShowErrors] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const slack = useRegisterSlackBYO();
  const dingtalk = useRegisterDingTalkBYO();
  const wecom = useRegisterWecomBYO();
  const pending =
    channel === "slack"
      ? slack.isPending
      : channel === "dingtalk"
        ? dingtalk.isPending
        : wecom.isPending;

  const errors = byoFieldErrors(channel, values);
  // Enabled whenever a request is not already in flight: pressing it on an
  // invalid form is what REVEALS the field errors. Gating it on validity
  // instead would leave the per-field messages unreachable — the button would
  // be dead exactly when there is something to say.
  const canPress = !pending;

  const submit = async () => {
    setShowErrors(true);
    if (!isByoSubmittable(channel, values) || pending) return;
    setSubmitError(null);
    try {
      if (channel === "slack") {
        await slack.mutateAsync({ agentId, body: byoRequestBody("slack", values) });
      } else if (channel === "dingtalk") {
        await dingtalk.mutateAsync({ agentId, body: byoRequestBody("dingtalk", values) });
      } else {
        await wecom.mutateAsync({ agentId, body: byoRequestBody("wecom", values) });
      }
      onClose();
    } catch (e) {
      // The server's own message is the useful one here (it names which
      // token it rejected, or that the app is already bound elsewhere), so
      // it is shown verbatim rather than replaced with a generic failure.
      setSubmitError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={keyboardBehavior}
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="border-b border-border px-4 py-3 flex-row items-center gap-3">
          <View className="size-8 rounded-lg bg-secondary items-center justify-center">
            <Ionicons name="link-outline" size={16} color={theme.mutedForeground} />
          </View>
          <Text className="flex-1 text-base font-semibold text-foreground">
            {t(TITLE_KEY[channel])}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityLabel={t("agents.integrations.byoCancel")}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={theme.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 py-5 gap-4"
          keyboardShouldPersistTaps="handled"
        >
          <Text className="text-xs text-muted-foreground leading-5">
            {t(DESCRIPTION_KEY[channel])}
          </Text>

          {FIELDS[channel].map((field) => {
            const message = showErrors ? errors[field.name] : undefined;
            return (
              <View key={field.name} className="gap-1.5">
                <Text className="text-xs font-medium text-foreground">
                  {t(field.labelKey)}
                </Text>
                <TextField
                  value={values[field.name] ?? ""}
                  onChangeText={(next) =>
                    setValues((prev) => ({ ...prev, [field.name]: next }))
                  }
                  placeholder={t(field.placeholderKey)}
                  secureTextEntry={field.secure}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!pending}
                  invalid={!!message}
                />
                {message ? (
                  <Text className="text-xs text-destructive">{t(message)}</Text>
                ) : field.hintKey ? (
                  <Text className="text-[11px] text-muted-foreground leading-4">
                    {t(field.hintKey)}
                  </Text>
                ) : null}
              </View>
            );
          })}

          {submitError ? (
            <Text className="text-xs text-destructive leading-4">{submitError}</Text>
          ) : null}
        </ScrollView>

        <View className="border-t border-border px-4 py-3 flex-row gap-2">
          <Button variant="outline" className="flex-1" onPress={onClose} disabled={pending}>
            <Text>{t("agents.integrations.byoCancel")}</Text>
          </Button>
          <Button className="flex-1" onPress={submit} disabled={!canPress}>
            {pending ? (
              <ActivityIndicator size="small" color={theme.primaryForeground} />
            ) : null}
            <Text>{t(SUBMIT_KEY[channel])}</Text>
          </Button>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
