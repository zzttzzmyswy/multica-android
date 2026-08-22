/**
 * Pure helpers for the autopilot webhook event-filter editor. Mirrors web
 * `packages/views/autopilots/components/autopilot-dialog.tsx` serialize
 * semantics and `webhook-event-filter-section.tsx` free-text-parse:
 *
 *  - `buildEventFilter`: "event" + comma-separated "actions" text → a wire
 *    `WebhookEventFilter` (`{event, actions?}` — actions key omitted when the
 *    text is blank, matching web).
 *  - `serializeEventFilters`: stable JSON for edit-mode dirty detection;
 *    normalizes omitted-vs-explicit-empty actions so they don't show as a
 *    phantom change. Same normalization as web's serializeEventFilters.
 *
 * Kept free of React/RN so parsing/serialization/dirty logic is
 * unit-testable.
 */
import type { WebhookEventFilter } from "@multica/core/types";

export function parseActionsText(text: string): string[] {
  return text
    .split(",")
    .map((action) => action.trim())
    .filter((action) => action.length > 0);
}

/** Blank event → null (nothing to add); actions key omitted when blank. */
export function buildEventFilter(
  event: string,
  actionsText: string,
): WebhookEventFilter | null {
  const ev = event.trim();
  if (!ev) return null;
  const actions = parseActionsText(actionsText);
  const next: WebhookEventFilter = { event: ev };
  if (actions.length > 0) next.actions = actions;
  return next;
}

export function canAddFilter(event: string): boolean {
  return event.trim().length > 0;
}

export function serializeEventFilters(
  filters: readonly WebhookEventFilter[],
): string {
  return JSON.stringify(
    filters.map((f) => ({ event: f.event, actions: f.actions ?? [] })),
  );
}