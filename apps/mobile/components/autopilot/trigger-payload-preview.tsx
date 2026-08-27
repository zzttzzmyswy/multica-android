/**
 * Webhook trigger-payload preview for a webhook autopilot run — mobile mirror
 * of web `packages/views/autopilots/components/webhook-payload-preview.tsx`.
 *
 * Renders the WebhookEnvelope (event / eventPayload / request.receivedAt /
 * request.contentType) inline; collapses by default and expands on tap like
 * the web card. The Copy button hands over the FULL pretty-printed payload
 * even when the visible body is truncated at 4 KiB.
 */
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";
import { useTranslation } from "@/lib/i18n/react";
import {
  parseTriggerPayload,
  type TriggerPayloadView,
} from "@/lib/trigger-payload";

interface TriggerPayloadPreviewProps {
  /** The run's trigger_payload (a WebhookEnvelope on the happy path). */
  payload: unknown;
  /** Whether to start expanded (default collapsed, matching web). */
  defaultOpen?: boolean;
}

export function TriggerPayloadPreview({
  payload,
  defaultOpen = false,
}: TriggerPayloadPreviewProps) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const view: TriggerPayloadView = useMemo(
    () => parseTriggerPayload(payload),
    [payload],
  );

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(view.fullJSON);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write failed (extremely rare) — silent, matching code-block.
    }
  };

  return (
    <View className="rounded-lg border border-border bg-background overflow-hidden">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        className="flex-row items-center gap-2 px-3 py-2 active:bg-secondary"
      >
        <Ionicons
          name="git-network-outline"
          size={14}
          color={theme.mutedForeground}
        />
        <Text className="text-xs font-medium">{t("autopilots.webhookPayload.label")}</Text>
        <Text
          className="flex-1 text-xs text-muted-foreground"
          numberOfLines={1}
        >
          {view.event ?? t("autopilots.webhookPayload.unknownEvent")}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={theme.mutedForeground}
        />
      </Pressable>

      {open ? (
        <View className="border-t border-border">
          <View className="flex-row items-center justify-between px-3 py-1.5">
            <Text className="text-[11px] text-muted-foreground">
              {view.contentType
                ? t("autopilots.webhookPayload.contentType", {
                    type: view.contentType,
                  })
                : t("autopilots.webhookPayload.payload")}
            </Text>
            <Pressable
              onPress={handleCopy}
              accessibilityRole="button"
              className="flex-row items-center gap-1 px-2 py-0.5 rounded active:bg-secondary"
            >
              <Ionicons
                name={copied ? "checkmark" : "copy-outline"}
                size={12}
                color={copied ? "#10b981" : theme.mutedForeground}
              />
              <Text className="text-[11px] text-muted-foreground">
                {copied
                  ? t("autopilots.webhookPayload.copiedShort")
                  : t("autopilots.webhookPayload.copy")}
              </Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            className="bg-secondary/40"
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
          >
            <Text className="text-[11px] font-mono leading-relaxed text-foreground">
              {view.displayJSON}
              {view.isTruncated ? (
                <Text className="text-muted-foreground">
                  {"\n" + t("autopilots.webhookPayload.truncatedMarker")}
                </Text>
              ) : null}
            </Text>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/** Loading skeleton for the lazily-fetched run payload. */
export function TriggerPayloadSkeleton() {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="rounded-lg border border-border bg-background px-3 py-3">
      <ActivityIndicator size="small" color={theme.mutedForeground} />
    </View>
  );
}