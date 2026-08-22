/**
 * Webhook-deliveries section for the autopilot detail screen — mobile mirror
 * of web `packages/views/autopilots/components/webhook-deliveries-section.tsx`.
 *
 * List is slim (status/provider/event/time); tapping a row opens a detail
 * modal that lazily fetches the full row (raw body / selected headers /
 * response body) and offers Replay. Status visuals degrade to a neutral
 * "unknown" row when the server adds a new enum value (API Response
 * Compatibility), never a crash.
 */
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import type {
  WebhookDelivery,
  WebhookSignatureStatus,
  WebhookDeliveryStatus,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { autopilotDeliveriesOptions } from "@/data/queries/autopilots";
import { useReplayAutopilotDelivery } from "@/data/mutations/autopilots";
import { formatDateTime } from "@/lib/autopilot-format";
import { cn } from "@/lib/utils";

// Status visuals — mirrors web STATUS_VISUAL. Unknown statuses (server enum
// drift) fall through to a neutral muted row with the raw status text.
const STATUS_VISUAL: Record<
  string,
  { className: string; color: string; icon: React.ComponentProps<typeof Ionicons>["name"]; spin?: boolean }
> = {
  queued: { className: "text-blue-500", color: "#3b82f6", icon: "time", spin: true },
  dispatched: { className: "text-emerald-500", color: "#22c55e", icon: "checkmark-circle" },
  rejected: { className: "text-destructive", color: "#ef4444", icon: "shield-outline" },
  ignored: { className: "text-muted-foreground", color: "#a1a1aa", icon: "ban" },
  failed: { className: "text-destructive", color: "#ef4444", icon: "close-circle" },
};

const UNKNOWN: { className: string; color: string; icon: React.ComponentProps<typeof Ionicons>["name"] } = {
  className: "text-muted-foreground",
  color: "#a1a1aa",
  icon: "alert-circle-outline",
};

function visualForStatus(status: string) {
  return STATUS_VISUAL[status] ?? UNKNOWN;
}

// Mirror web canReplay: signature-invalid / rejected / still-queued
// deliveries can't be replayed (the server is the gate and would 400).
function canReplay(delivery: WebhookDelivery): boolean {
  if (delivery.signature_status === "invalid") return false;
  if (delivery.status === "rejected") return false;
  if (delivery.status === "queued") return false;
  return true;
}

const KNOWN_STATUSES: readonly WebhookDeliveryStatus[] = [
  "queued",
  "dispatched",
  "rejected",
  "ignored",
  "failed",
];

const KNOWN_SIGNATURES: readonly WebhookSignatureStatus[] = [
  "not_required",
  "valid",
  "invalid",
  "missing",
];

export function DeliveriesSection({
  wsId,
  autopilotId,
  hasWebhookTrigger,
  t,
}: {
  wsId: string | null;
  autopilotId: string;
  hasWebhookTrigger: boolean;
  t: (id: string) => string;
}) {
  const { data: deliveries = [], isLoading } = useQuery(
    autopilotDeliveriesOptions(wsId, autopilotId, {
      enabled: hasWebhookTrigger,
    }),
  );
  const [selected, setSelected] = useState<WebhookDelivery | null>(null);

  // No webhook trigger → the section is irrelevant; hide instead of an empty
  // card (matches web).
  if (!hasWebhookTrigger) return null;

  return (
    <View className="gap-1.5">
      <Text className="px-4 pt-5 pb-2 text-xs uppercase tracking-wider text-muted-foreground font-medium">
        {t("autopilots.deliveries.sectionTitle")}
      </Text>
      {isLoading ? (
        <View className="px-4 py-4">
          <ActivityIndicator />
        </View>
      ) : deliveries.length === 0 ? (
        <Text className="px-4 text-sm text-muted-foreground">
          {t("autopilots.deliveries.empty")}
        </Text>
      ) : (
        <View className="mx-4 rounded-lg border border-border overflow-hidden">
          {deliveries.map((delivery, idx) => (
            <View key={delivery.id}>
              {idx > 0 ? <View className="h-px bg-border" /> : null}
              <Pressable
                onPress={() => setSelected(delivery)}
                className="flex-row items-center gap-2.5 px-3 py-2.5 active:bg-secondary"
                accessibilityLabel={t("autopilots.deliveries.detailTitle")}
              >
                <DeliveryVisual delivery={delivery} t={t} />
                <View className="flex-1 min-w-0">
                  <Text className="text-xs text-muted-foreground">
                    {delivery.provider || "—"}
                  </Text>
                  <Text className="text-xs text-muted-foreground font-mono" numberOfLines={1}>
                    {delivery.event || t("autopilots.deliveries.unknownEvent")}
                  </Text>
                </View>
                <Text className="text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(delivery.received_at || delivery.created_at)}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {selected ? (
        <DeliveryDetailModal
          autopilotId={autopilotId}
          delivery={selected}
          onClose={() => setSelected(null)}
          t={t}
        />
      ) : null}
    </View>
  );
}

function DeliveryVisual({
  delivery,
  t,
}: {
  delivery: WebhookDelivery;
  t: (id: string) => string;
}) {
  const visual = visualForStatus(delivery.status);
  const label = KNOWN_STATUSES.includes(delivery.status as WebhookDeliveryStatus)
    ? t(`autopilots.deliveries.status.${delivery.status}`)
    : delivery.status;
  return (
    <View className="w-24 shrink-0 flex-row items-center gap-1">
      <Ionicons name={visual.icon} size={13} color={visual.color} />
      <Text className={cn("text-xs font-medium", visual.className)} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function DeliveryDetailModal({
  autopilotId,
  delivery,
  onClose,
  t,
}: {
  autopilotId: string;
  delivery: WebhookDelivery;
  onClose: () => void;
  t: (id: string) => string;
}) {
  const replay = useReplayAutopilotDelivery();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const visual = visualForStatus(delivery.status);
  const statusLabel = KNOWN_STATUSES.includes(
    delivery.status as WebhookDeliveryStatus,
  )
    ? t(`autopilots.deliveries.status.${delivery.status}`)
    : delivery.status;
  const signatureLabel = KNOWN_SIGNATURES.includes(
    delivery.signature_status as WebhookSignatureStatus,
  )
    ? t(`autopilots.deliveries.signature.${delivery.signature_status}`)
    : delivery.signature_status;

  const handleCopy = async (key: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleReplay = async () => {
    try {
      await replay.mutateAsync({ autopilotId, deliveryId: delivery.id });
      Alert.alert(t("autopilots.deliveries.replayed"));
      onClose();
    } catch (err) {
      Alert.alert(
        t("autopilots.deliveries.replayFailed"),
        err instanceof Error ? err.message : undefined,
      );
    }
  };

  const headers = delivery.selected_headers;
  const headerText =
    headers && typeof headers === "object"
      ? JSON.stringify(headers, null, 2)
      : null;
  const replayDisabled = !canReplay(delivery) || replay.isPending;

  const blocks: { key: string; label: string; value: string }[] = [];
  if (delivery.raw_body) blocks.push({ key: "raw", label: t("autopilots.deliveries.rawBody"), value: delivery.raw_body });
  if (headerText) blocks.push({ key: "headers", label: t("autopilots.deliveries.headers"), value: headerText });
  if (delivery.response_body) blocks.push({ key: "response", label: t("autopilots.deliveries.responseBody"), value: delivery.response_body });

  const metaRows: { label: string; value: string }[] = [
    { label: t("autopilots.deliveries.receivedAt"), value: formatDateTime(delivery.received_at) },
    { label: t("autopilots.deliveries.lastAttemptAt"), value: formatDateTime(delivery.last_attempt_at) },
    { label: t("autopilots.deliveries.attempts"), value: String(delivery.attempt_count) },
    { label: t("autopilots.deliveries.dispatchAttempts"), value: String(delivery.dispatch_attempts) },
    { label: t("autopilots.deliveries.response"), value: delivery.response_status != null ? String(delivery.response_status) : "—" },
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 items-center justify-center px-4 py-8">
          <Pressable onPress={() => {}} className="w-full max-w-md">
            <View className="bg-popover rounded-2xl overflow-hidden max-h-[80vh]">
              <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
                <Ionicons name="link-outline" size={15} color="#a1a1aa" />
                <Text className="flex-1 text-base font-semibold text-foreground">
                  {t("autopilots.deliveries.detailTitle")}
                </Text>
                <Pressable onPress={onClose} hitSlop={8} accessibilityLabel={t("common.close")}>
                  <Ionicons name="close" size={20} color="#a1a1aa" />
                </Pressable>
              </View>

              <ScrollView className="max-h-[80vh]">
                <View className="gap-3 px-4 py-3">
                  {/* Header row — status / provider / event / signature */}
                  <View className="flex-row flex-wrap items-center gap-2">
                    <View className="flex-row items-center gap-1.5">
                      <Ionicons name={visual.icon} size={14} color={visual.color} />
                      <Text className={cn("text-sm font-medium", visual.className)}>
                        {statusLabel}
                      </Text>
                    </View>
                    <Badge text={delivery.provider || "—"} />
                    <Badge
                      text={delivery.event || t("autopilots.deliveries.unknownEvent")}
                      mono
                    />
                    <Badge
                      text={signatureLabel}
                      tone={
                        delivery.signature_status === "invalid"
                          ? "destructive"
                          : delivery.signature_status === "valid"
                            ? "default"
                            : undefined
                      }
                    />
                  </View>

                  {/* Meta grid */}
                  <View className="rounded-md border border-border px-3 py-2 gap-1.5">
                    {metaRows.map((row) => (
                      <View key={row.label} className="flex-row">
                        <Text className="w-32 text-xs text-muted-foreground">
                          {row.label}
                        </Text>
                        <Text className="flex-1 text-xs text-foreground">
                          {row.value}
                        </Text>
                      </View>
                    ))}
                    {delivery.error ? (
                      <View className="flex-row">
                        <Text className="w-32 text-xs text-destructive">
                          {t("autopilots.deliveries.error")}
                        </Text>
                        <Text className="flex-1 text-xs text-destructive">
                          {delivery.error}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Code blocks */}
                  {blocks.map((block) => (
                    <View key={block.key} className="rounded-md border border-border overflow-hidden">
                      <View className="flex-row items-center justify-between border-b border-border px-3 py-1.5">
                        <Text className="text-[11px] font-medium text-muted-foreground">
                          {block.label}
                        </Text>
                        <Pressable
                          onPress={() => void handleCopy(block.key, block.value)}
                          hitSlop={8}
                          className="flex-row items-center gap-1 px-1 py-0.5"
                          accessibilityLabel={t("autopilots.deliveries.copy")}
                        >
                          <Ionicons
                            name={copiedKey === block.key ? "checkmark" : "copy-outline"}
                            size={12}
                            color={copiedKey === block.key ? "#22c55e" : "#a1a1aa"}
                          />
                          <Text className="text-[11px] text-muted-foreground">
                            {copiedKey === block.key
                              ? t("autopilots.deliveries.copied")
                              : t("autopilots.deliveries.copy")}
                          </Text>
                        </Pressable>
                      </View>
                      <ScrollView
                        className="max-h-40 bg-muted/40 px-3 py-2"
                        nestedScrollEnabled
                      >
                        <Text className="text-xs font-mono text-foreground leading-relaxed">
                          {block.value}
                        </Text>
                      </ScrollView>
                    </View>
                  ))}

                  {/* Replay */}
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => void handleReplay()}
                    disabled={replayDisabled}
                  >
                    <Ionicons
                      name="refresh"
                      size={14}
                      color={replayDisabled ? undefined : "#a1a1aa"}
                    />
                    <Text>
                      {replay.isPending
                        ? t("autopilots.deliveries.replaying")
                        : t("autopilots.deliveries.replay")}
                    </Text>
                  </Button>
                </View>
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function Badge({
  text,
  mono,
  tone,
}: {
  text: string;
  mono?: boolean;
  tone?: "default" | "destructive";
}) {
  return (
    <View
      className={cn(
        "rounded border border-border px-1.5 py-0.5",
        tone === "destructive" ? "border-destructive/40" : undefined,
      )}
    >
      <Text
        className={cn(
          "text-[11px]",
          mono ? "font-mono text-muted-foreground" : "text-foreground",
          tone === "destructive" ? "text-destructive" : undefined,
        )}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}