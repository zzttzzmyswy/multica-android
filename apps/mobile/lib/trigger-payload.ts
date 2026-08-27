/**
 * Webhook trigger-payload view model (web alignment, iteration 111).
 *
 * Mirrors web `WebhookPayloadPreview` (packages/views/autopilots/components/
 * webhook-payload-preview.tsx): pulls the WebhookEnvelope shape produced
 * server-side by normalizeWebhookPayload — `event` / `eventPayload` /
 * `request.{receivedAt, contentType}` — and falls back to showing the whole
 * payload as-is when it doesn't match the envelope shape, so nothing is
 * hidden.
 */
export const TRIGGER_PAYLOAD_TRUNCATE_AT = 4096;

export interface TriggerPayloadView {
  /** Envelope `event` name, or null when the payload isn't an envelope. */
  event: string | null;
  /** Envelope `request.receivedAt` (ISO string), or null. */
  receivedAt: string | null;
  /** Envelope `request.contentType`, or null. */
  contentType: string | null;
  /** Pretty-printed JSON of the event payload — always the FULL text (Copy hands this over). */
  fullJSON: string;
  /** `fullJSON` truncated at TRIGGER_PAYLOAD_TRUNCATE_AT for display. */
  displayJSON: string;
  /** True when `fullJSON` exceeds the display threshold. */
  isTruncated: boolean;
}

export function parseTriggerPayload(
  payload: unknown | null | undefined,
): TriggerPayloadView {
  let event: string | null = null;
  let eventPayload: unknown = null;
  let receivedAt: string | null = null;
  let contentType: string | null = null;

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.event === "string") event = obj.event;
    if ("eventPayload" in obj) eventPayload = obj.eventPayload;
    const req = obj.request;
    if (req && typeof req === "object") {
      const r = req as Record<string, unknown>;
      if (typeof r.receivedAt === "string") receivedAt = r.receivedAt;
      if (typeof r.contentType === "string") contentType = r.contentType;
    }
  }

  // Payload didn't match the envelope shape (a caller wrote directly to
  // trigger_payload, malformed history row, …) — show the whole thing as
  // the event payload so nothing is hidden.
  if (eventPayload === null && payload !== null && payload !== undefined) {
    eventPayload = payload;
  }

  const stringified = JSON.stringify(eventPayload, null, 2);
  const fullJSON = stringified === undefined ? "" : stringified;
  const isTruncated = fullJSON.length > TRIGGER_PAYLOAD_TRUNCATE_AT;
  const displayJSON = isTruncated
    ? fullJSON.slice(0, TRIGGER_PAYLOAD_TRUNCATE_AT)
    : fullJSON;

  return { event, receivedAt, contentType, fullJSON, displayJSON, isTruncated };
}