/**
 * Webhook-deliveries section for the autopilot detail screen — mobile mirror
 * of web `packages/views/autopilots/components/webhook-deliveries-section.tsx`.
 *
 * List is slim (status/provider/event/time + replay/attempts badges); tapping
 * a row opens a detail modal that LAZILY fetches the full row (raw body /
 * selected headers / response body — the list endpoint omits these to keep
 * the wire small) and offers Replay with a disable-hint. Status visuals
 * degrade to a neutral "unknown" row when the server adds a new enum value
 * (API Response Compatibility), never a crash.
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
import {
  autopilotDeliveriesOptions,
  autopilotDeliveryOptions,
} from "@/data/queries/autopilots";
import { useReplayAutopilotDelivery } from "@/data/mutations/autopilots";
import { formatDateTime } from "@/lib/autopilot-format";
import {
  buildDeliveryMetaRows,
  canReplay,
  truncateForDisplay,
} from "@/lib/autopilot-delivery";
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

/** Disabled-replay reason → i18n key, mirroring web `ReplayHint`. */
function replayDisabledReasonKey(delivery: WebhookDelivery): string | null {
  if (delivery.signature_status === "invalid") {
    return "autopilots.deliveries.replay.disabledInvalidSignature";
  }
  if (delivery.status === "rejected") {
    return "autopilots.deliveries.replay.disabledRejected";
  }
  if (delivery.status === "queued") {
    return "autopilots.deliveries.replay.disabledQueued";
  }
  return null;
}

export function DeliveriesSection({
  wsId,
  autopilotId,
  hasWebhookTrigger,
  t,
}: {
  wsId: string | null;
  autopilotId: string;
  hasWebhookTrigger: boolean;
  t: (id: string, params?: Record<string, string | number>) => string;
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
                {/* Row badges — replay / attempts (web DeliveryRow). */}
                {delivery.replayed_from_delivery_id ? <RowBadge text={t("autopilots.deliveries.row.replayBadge")} icon="refresh" /> : null}
                {delivery.attempt_count > 1 ? (
                  <RowBadge
                    text={t("autopilots.deliveries.row.attempts", {
                      count: delivery.attempt_count,
                    })}
                  />
                ) : null}
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
          wsId={wsId}
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
  t: (id: string, params?: Record<string, string | number>) => string;
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

function RowBadge({ text, icon }: { text: string; icon?: React.ComponentProps<typeof Ionicons>["name"] }) {
  return (
    <View className="shrink-0 flex-row items-center gap-0.5 rounded border border-border px-1.5 py-0.5">
      {icon ? <Ionicons name={icon} size={10} color="#a1a1aa" /> : null}
      <Text className="text-[10px] text-muted-foreground">{text}</Text>
    </View>
  );
}

function DeliveryDetailModal({
  wsId,
  autopilotId,
  delivery,
  onClose,
  t,
}: {
  wsId: string | null;
  autopilotId: string;
  delivery: WebhookDelivery;
  onClose: () => void;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  const replay = useReplayAutopilotDelivery();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Lazily fetch the full row (raw_body / selected_headers / response_body
  // are detail-only). Cached per deliveryId by react-query, so re-opens are
  // instant. `full` falls back to the slim list row while loading.
  const { data: detail, isLoading } = useQuery(
    autopilotDeliveryOptions(wsId, autopilotId, delivery.id, { enabled: true }),
  );
  const full = detail ?? delivery;

  const visual = visualForStatus(full.status);
  const statusLabel = KNOWN_STATUSES.includes(full.status as WebhookDeliveryStatus)
    ? t(`autopilots.deliveries.status.${full.status}`)
    : full.status;
  const signatureLabel = KNOWN_SIGNATURES.includes(
    full.signature_status as WebhookSignatureStatus,
  )
    ? t(`autopilots.deliveries.signature.${full.signature_status}`)
    : full.signature_status;

  const metaRows = useMemo(
    () => buildDeliveryMetaRows(full, t, formatDateTime),
    [full, t],
  );

  const handleCopy = async (key: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleReplay = async () => {
    try {
      await replay.mutateAsync({ autopilotId, deliveryId: full.id });
      Alert.alert(t("autopilots.deliveries.replayed"));
      onClose();
    } catch (err) {
      Alert.alert(
        t("autopilots.deliveries.replayFailed"),
        err instanceof Error ? err.message : undefined,
      );
    }
  };

  const headers = full.selected_headers;
  const headerText =
    headers && typeof headers === "object"
      ? JSON.stringify(headers, null, 2)
      : null;
  const replayDisabled = !canReplay(full) || replay.isPending;
  const disableReasonKey = replayDisabledReasonKey(full);

  const blocks: { key: string; label: string; value: string }[] = [];
  if (full.raw_body)
    blocks.push({ key: "raw", label: t("autopilots.deliveries.rawBody"), value: full.raw_body });
  if (headerText)
    blocks.push({ key: "headers", label: t("autopilots.deliveries.headers"), value: headerText });
  if (full.response_body)
    blocks.push({ key: "response", label: t("autopilots.deliveries.responseBody"), value: full.response_body });

  const bodyLoading = isLoading && !detail;

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

              {bodyLoading ? (
                <View className="gap-3 px-4 py-4">
                  <View className="h-20 rounded-md bg-muted/50" />
                  <View className="h-14 rounded-md bg-muted/50" />
                </View>
              ) : (
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
                      <Badge text={full.provider || "—"} />
                      <Badge
                        text={full.event || t("autopilots.deliveries.unknownEvent")}
                        mono
                      />
                      <Badge
                        text={signatureLabel}
                        tone={
                          full.signature_status === "invalid"
                            ? "destructive"
                            : full.signature_status === "valid"
                              ? "default"
                              : undefined
                        }
                      />
                    </View>

                    {/* Meta grid — web order incl. queued-only + dedupe rows */}
                    <View className="rounded-md border border-border px-3 py-2 gap-1.5">
                      {metaRows.map((row) => (
                        <View key={row.key} className="flex-row">
                          <Text className="w-32 text-xs text-muted-foreground">
                            {row.label}
                          </Text>
                          <Text
                            className={cn(
                              "flex-1 text-xs text-foreground",
                              row.mono ? "font-mono" : undefined,
                            )}
                            numberOfLines={2}
                          >
                            {row.value}
                          </Text>
                        </View>
                      ))}
                      {full.error ? (
                        <View className="flex-row">
                          <Text className="w-32 text-xs text-destructive">
                            {t("autopilots.deliveries.error")}
                          </Text>
                          <Text className="flex-1 text-xs text-destructive">
                            {full.error}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Code blocks — sliced for display, Copy yields full */}
                    {blocks.map((block) => (
                      <CodeBlock
                        key={block.key}
                        label={block.label}
                        value={block.value}
                        copied={copiedKey === block.key}
                        onCopy={() => void handleCopy(block.key, block.value)}
                        copyLabel={
                          copiedKey === block.key
                            ? t("autopilots.deliveries.copied")
                            : t("autopilots.deliveries.copy")
                        }
                        truncatedMarker={t("autopilots.deliveries.truncatedMarker")}
                      />
                    ))}

                    {/* Replay + disabled reason */}
                    <View className="gap-1.5">
                      {disableReasonKey ? (
                        <Text className="text-xs text-muted-foreground">
                          {t(disableReasonKey)}
                        </Text>
                      ) : null}
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
                  </View>
                </ScrollView>
              )}
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

function CodeBlock({
  label,
  value,
  copied,
  onCopy,
  copyLabel,
  truncatedMarker,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  copyLabel: string;
  truncatedMarker: string;
}) {
  const { display, truncated } = truncateForDisplay(value);
  return (
    <View className="rounded-md border border-border overflow-hidden">
      <View className="flex-row items-center justify-between border-b border-border px-3 py-1.5">
        <Text className="text-[11px] font-medium text-muted-foreground">{label}</Text>
        <Pressable
          onPress={onCopy}
          hitSlop={8}
          className="flex-row items-center gap-1 px-1 py-0.5"
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={12}
            color={copied ? "#22c55e" : "#a1a1aa"}
          />
          <Text className="text-[11px] text-muted-foreground">{copyLabel}</Text>
        </Pressable>
      </View>
      <ScrollView className="max-h-40 bg-muted/40 px-3 py-2" nestedScrollEnabled>
        <Text className="text-xs font-mono text-foreground leading-relaxed">{display}</Text>
        {truncated ? (
          <Text className="pt-2 text-xs text-muted-foreground">{truncatedMarker}</Text>
        ) : null}
      </ScrollView>
    </View>
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