/**
 * Webhook-delivery presentation helpers — mirror web
 * `packages/views/autopilots/components/webhook-deliveries-section.tsx` rules
 * (canReplay / code-block truncation / detail meta-grid order) as pure
 * functions so the component stays declarative and the rules stay testable.
 */
import type { WebhookDelivery } from "@multica/core/types";

/**
 * A delivery is replayable when (a) the server allows it (signature is not
 * invalid AND the delivery wasn't rejected) and (b) we have something to
 * replay. `queued` deliveries are mid-flight on the server — replay would
 * race the synchronous dispatch path. Unknown status values (server drift)
 * stay replayable rather than block the button on a stale enum.
 */
export function canReplay(delivery: WebhookDelivery): boolean {
  if (delivery.signature_status === "invalid") return false;
  if (delivery.status === "rejected") return false;
  if (delivery.status === "queued") return false;
  return true;
}

/** Large bodies are truncated for on-screen display; Copy still yields the full string. */
export const TRUNCATE_LIMIT = 4096;

export function truncateForDisplay(
  value: string,
  limit: number = TRUNCATE_LIMIT,
): { display: string; truncated: boolean } {
  const truncated = value.length > limit;
  return { display: truncated ? value.slice(0, limit) : value, truncated };
}

export interface DeliveryMetaRow {
  key: string;
  label: string;
  value: string;
  mono?: boolean;
}

/**
 * Detail-dialog meta grid, in web `DeliveryDetailDialog` order:
 * received_at / last_attempt_at / attempt_count / dispatch_attempts,
 * available_at only while queued, response_status, dedupe_key /
 * dedupe_source (always shown, em-dash when absent), then optional
 * content_type / replayed_from when present.
 */
export function buildDeliveryMetaRows(
  delivery: WebhookDelivery,
  resolve: (key: string) => string,
  date: (iso: string | null | undefined) => string,
): DeliveryMetaRow[] {
  const rows: DeliveryMetaRow[] = [
    { key: "receivedAt", label: resolve("autopilots.deliveries.receivedAt"), value: date(delivery.received_at) },
    {
      key: "lastAttemptAt",
      label: resolve("autopilots.deliveries.lastAttemptAt"),
      value: date(delivery.last_attempt_at),
    },
    { key: "attempts", label: resolve("autopilots.deliveries.attempts"), value: String(delivery.attempt_count) },
    {
      key: "dispatchAttempts",
      label: resolve("autopilots.deliveries.dispatchAttempts"),
      value: String(delivery.dispatch_attempts),
    },
  ];
  if (delivery.status === "queued") {
    rows.push({
      key: "availableAt",
      label: resolve("autopilots.deliveries.availableAt"),
      value: date(delivery.available_at),
    });
  }
  rows.push({
    key: "response",
    label: resolve("autopilots.deliveries.response"),
    value: delivery.response_status != null ? String(delivery.response_status) : "—",
  });
  rows.push({
    key: "dedupeKey",
    label: resolve("autopilots.deliveries.dedupeKey"),
    value: delivery.dedupe_key ?? "—",
    mono: true,
  });
  rows.push({
    key: "dedupeSource",
    label: resolve("autopilots.deliveries.dedupeSource"),
    value: delivery.dedupe_source ?? "—",
  });
  if (delivery.content_type) {
    rows.push({ key: "contentType", label: resolve("autopilots.deliveries.contentType"), value: delivery.content_type, mono: true });
  }
  if (delivery.replayed_from_delivery_id) {
    rows.push({
      key: "replayedFrom",
      label: resolve("autopilots.deliveries.replayedFrom"),
      value: delivery.replayed_from_delivery_id,
      mono: true,
    });
  }
  return rows;
}