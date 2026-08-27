/**
 * Pure helpers for the autopilot trigger form (create + edit) and the
 * create-autopilot form's schedule panel. Kept free of React/RN so the
 * cron probe classification and payload building are unit-testable.
 *
 * - `COMMON_TIMEZONES`: curated fallback list mirroring web's
 *   packages/views/common/timezone-select.tsx — used when the runtime lacks
 *   `Intl.supportedValuesOf`.
 * - `classifyScheduleRejection` / `probeSchedule`: the submit gate for a
 *   schedule trigger — the server answers cron-preview with 400 for a
 *   rejected expression, and the UI must tell the user which input is at
 *   fault (cron box vs timezone), echoing the parser's own words.
 * - `buildTriggerCreate` / `buildTriggerUpdate`: form state → validated wire
 *   payloads (both pass through AutopilotTriggerFormSchema, the zod
 *   contract the form layer owns for these endpoints — drift defense).
 */
import {
  AutopilotTriggerFormSchema,
  type AutopilotTriggerFormValues,
} from "@/data/schemas";
import type { WebhookEventFilter } from "@multica/core/types";
import { parseCron } from "./schedule-editor-cron";
import { getDefaultScheduleConfig } from "./schedule-editor-model";
import type { ScheduleConfig } from "./schedule-editor-model";

/** Curated timezone fallback — mirror of packages/views/common/timezone-select.tsx. */
export const COMMON_TIMEZONES: readonly string[] = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Moscow",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function browserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export interface TriggerFormState {
  kind: "schedule" | "webhook";
  cronExpression: string;
  timezone: string;
  label: string;
  enabled: boolean;
  /** Only meaningful for webhook triggers; [] means "accept all events". */
  eventFilters: WebhookEventFilter[];
}

/**
 * Hydrate an existing schedule trigger into the structured ScheduleConfig the
 * editor edits. An empty/absent cron (never valid for a schedule trigger, but
 * reachable while a detail query is still in flight) falls back to the
 * default schedule; a beyond-model expression round-trips verbatim in `raw`.
 * Trimming mirrors the webhook URL builder's whitespace hygiene.
 */
export function scheduleFromTrigger(
  cronExpression: string | null | undefined,
  timezone: string | null | undefined,
): ScheduleConfig {
  const tz = (timezone ?? "").trim() || "Asia/Shanghai";
  const cron = (cronExpression ?? "").trim();
  return cron.length === 0
    ? getDefaultScheduleConfig(tz)
    : parseCron(cron, tz);
}

/** The server's rejection, split the way the editor is: which input is at
 *  fault (the cron box or the timezone picker), and the parser's own words. */
export interface ScheduleRejection {
  code: "invalid_cron" | "invalid_timezone";
  detail: string;
}

/** Mirrors web's classifyScheduleRejection — anything but an explicit
 *  invalid_timezone tag is the cron's fault. */
export function classifyScheduleRejection(err: {
  status: number;
  message: string;
  body?: unknown;
}): ScheduleRejection {
  const body =
    typeof err.body === "object" && err.body !== null ? err.body : {};
  const code = (body as { code?: unknown }).code;
  return {
    code: code === "invalid_timezone" ? "invalid_timezone" : "invalid_cron",
    detail: err.message,
  };
}

/**
 * Ask the server whether it accepts this schedule. Returns the classified
 * rejection on a 400 (the server is the source of truth for cron syntax);
 * transport failures and non-400s resolve to null — an unreachable preview
 * endpoint must not block saving a schedule the server accepts.
 */
export async function probeSchedule(
  probe: (params: { expr: string; tz: string }) => Promise<unknown>,
  expr: string,
  tz: string,
): Promise<ScheduleRejection | null> {
  try {
    await probe({ expr, tz });
    return null;
  } catch (err) {
    const maybe = err as { status?: unknown; message?: unknown; body?: unknown };
    if (maybe.status !== 400) return null;
    return classifyScheduleRejection({
      status: 400,
      message:
        typeof maybe.message === "string" ? maybe.message : String(maybe.message),
      body: maybe.body,
    });
  }
}

/** Schedule fields are only sent for schedule triggers; a webhook trigger
 *  accepts all events (v1 — no event_filters editing on mobile). */
function scheduleFields(values: TriggerFormState): {
  cron_expression?: string;
  timezone?: string;
} {
  if (values.kind !== "schedule") return {};
  const cron = values.cronExpression.trim();
  const tz = values.timezone.trim();
  return {
    ...(cron.length > 0 ? { cron_expression: cron } : {}),
    ...(tz.length > 0 ? { timezone: tz } : {}),
  };
}

/**
 * Create payload — kind + schedule fields; a webhook trigger ships its event
 * filters only when non-empty (empty = "accept all events", mirroring web's
 * `event_filters: eventFilters.length > 0 ? eventFilters : undefined`).
 */
export function buildTriggerCreate(
  values: TriggerFormState,
): AutopilotTriggerFormValues {
  const eventFilters =
    values.kind === "webhook" && values.eventFilters.length > 0
      ? values.eventFilters
      : undefined;
  const parsed = AutopilotTriggerFormSchema.parse({
    kind: values.kind,
    ...scheduleFields(values),
    ...(eventFilters ? { event_filters: eventFilters } : {}),
  });
  return parsed;
}

/**
 * Update payload — label/enabled for both kinds, schedule fields only for
 * schedule triggers. Absent optional fields mean "leave untouched" on PATCH.
 * `kind` is not PATCH-able (in-place kind swaps are not supported — web
 * converts via "delete old, create new"), so it is stripped here.
 *
 * `event_filters` is shipped ONLY when the caller passes it explicitly via
 * `opts.eventFilters` (edit-mode dirty gate: the editor PATCHes filters only
 * when its snapshot differs — web `eventFiltersDirty`). undefined = don't
 * touch; [] = clear server-side; non-empty = set.
 */
export function buildTriggerUpdate(
  values: TriggerFormState,
  opts?: { eventFilters?: WebhookEventFilter[] | null },
): Omit<AutopilotTriggerFormValues, "kind"> {
  const eventFilters =
    values.kind === "webhook"
      ? opts?.eventFilters
      : undefined;
  const parsed = AutopilotTriggerFormSchema.parse({
    kind: values.kind,
    ...scheduleFields(values),
    label: values.label.trim(),
    enabled: values.enabled,
    ...(eventFilters !== undefined ? { event_filters: eventFilters } : {}),
  });
  const { kind: _kind, ...rest } = parsed;
  return rest;
}