/**
 * Autopilots-LIST action + presentation decisions — the pure half of web's
 * `autopilot-list-actions.tsx` (302 lines) and the list page's `LastRunCell`
 * (`autopilots-page.tsx:327-373`), lifted out of JSX so the gating rules are
 * testable in the Node vitest lane (no RN renderer there — see
 * `vitest.config.ts`).
 *
 * Three rules are mirrored from web verbatim, each one a place a plausible
 * edit silently changes product semantics:
 *
 *   1. **The row kebab is hidden, not disabled, for a member without write.**
 *      Web returns `null` outright (`autopilot-list-actions.tsx:156`): apart
 *      from "open in new tab" the menu holds only write actions, so there is
 *      nothing left to offer. An absent `can_write` (older server) keeps the
 *      menu visible — the backend stays the gate, exactly as the detail page
 *      already reads it.
 *   2. **The batch toolbar adapts to the selection's own statuses.** It offers
 *      pause when ANY selected row is active and resume when ANY is paused
 *      (`:242`), so a mixed selection gets both buttons rather than a guess.
 *   3. **A status write skips rows already in the target status.** Web's
 *      `useSetStatus` (`:107`) `continue`s past them instead of PATCHing a row
 *      to the value it already holds.
 *
 * `autopilotRowActions` is the mobile port of web's `AutopilotRowActions`
 * menu minus its one desktop-only entry: web also lists "Open in new tab"
 * (`ExternalLink`, `:175`), which is a browser-tab concept — on a phone the
 * row tap already opens the autopilot — so it is omitted for the same reason
 * `lib/agent-row-actions.ts` omits it from the agents list.
 */
import type { Autopilot, AutopilotRunSource } from "@multica/core/types";
import { runStatusKey } from "./i18n/dynamic-families";

export type AutopilotRowAction = "pause" | "resume" | "delete";

/**
 * Web's `runStatusDotClass` (`autopilots-page.tsx:327-340`), value for value.
 *
 * `issue_created` shares `completed`'s green because both mean "the run
 * finished its job"; the difference (an issue was filed vs a run-only
 * dispatch) is in the label, not the dot. Note this is NOT the same mapping as
 * the detail page's run-history icons, where `issue_created` is blue — web
 * makes the same distinction between `LastRunCell` here and `RUN_VISUAL`
 * there, so the two surfaces intentionally disagree.
 *
 * Server-driven enum: an unknown status falls through to the neutral dot
 * rather than crashing (API Response Compatibility).
 */
const RUN_STATUS_DOT_CLASS: Record<string, string> = {
  completed: "bg-emerald-500",
  issue_created: "bg-emerald-500",
  failed: "bg-red-500",
  skipped: "bg-amber-500",
  running: "bg-blue-500",
};

const RUN_STATUS_DOT_FALLBACK = "bg-muted-foreground/40";

/** The five run statuses the backend emits (`AutopilotRunStatus`), in the
 *  order web's `run_status` bundle lists them. Anything else is enum drift. */
const KNOWN_RUN_STATUSES = [
  "issue_created",
  "running",
  "completed",
  "failed",
  "skipped",
] as const;

export type KnownRunStatus = (typeof KNOWN_RUN_STATUSES)[number];

export function runStatusDotClass(status: string | null | undefined): string {
  return (status && RUN_STATUS_DOT_CLASS[status]) || RUN_STATUS_DOT_FALLBACK;
}

/** Whether this is one of the five statuses the app has copy for. */
export function knownRunStatus(
  status: string | null | undefined,
): status is KnownRunStatus {
  return (
    !!status && (KNOWN_RUN_STATUSES as readonly string[]).includes(status)
  );
}

/**
 * The i18n id for a known run status, or `null` for enum drift — in which case
 * the caller renders the raw server string, as web does (`:365`).
 *
 * The ids come from `lib/i18n/dynamic-families`' `RUN_STATUS_KEYS` rather than
 * being written here: that table is the one place the wire vocabulary is
 * translated to dictionary leaves, and `issue_created` → `issueCreated` is a
 * translation a caller cannot be trusted to repeat (MYS-2433 — the detail page
 * interpolated the raw value and printed the id).
 */
/** Localized run-status text, falling back to the raw server value. */
export function runStatusLabel(
  status: string | null | undefined,
  t: (id: string) => string,
): string {
  if (!status) return "";
  return knownRunStatus(status) ? t(runStatusKey(status)) : status;
}

/** The four run sources the backend emits (`AutopilotRunSource`). */
const KNOWN_RUN_SOURCES: readonly AutopilotRunSource[] = [
  "schedule",
  "manual",
  "webhook",
  "api",
];

/** Whether this is one of the four sources the app has copy for. */
export function knownRunSource(
  source: string | null | undefined,
): source is AutopilotRunSource {
  return !!source && (KNOWN_RUN_SOURCES as readonly string[]).includes(source);
}

/**
 * Whether this row offers a kebab at all. Web hides it for a member without
 * write (`:156`); `undefined` means an older server, which stays visible so the
 * backend remains the gate.
 */
export function canWriteAutopilot(row: Pick<Autopilot, "can_write">): boolean {
  return row.can_write !== false;
}

/**
 * The kebab's items, in menu order. Web switches on the row's own status, so
 * exactly one of pause/resume is ever present; delete always is. An empty list
 * means "no menu" — the caller hides the trigger rather than opening an empty
 * sheet (the same contract `agentRowActions` has).
 */
export function autopilotRowActions(
  row: Pick<Autopilot, "status" | "can_write">,
): AutopilotRowAction[] {
  if (!canWriteAutopilot(row)) return [];
  const actions: AutopilotRowAction[] = [];
  if (row.status === "active") actions.push("pause");
  if (row.status === "paused") actions.push("resume");
  // Web offers Delete unconditionally — including on an `archived` row, which
  // is the only way to remove one.
  actions.push("delete");
  return actions;
}

/**
 * Which buttons the batch toolbar shows for this selection. Web's rule
 * (`autopilot-list-actions.tsx:236-244`): each of pause/resume appears when ANY
 * selected row is in the opposite state, so a mixed batch offers both. Delete
 * needs only a non-empty selection.
 */
export function autopilotBatchActions(
  rows: readonly Pick<Autopilot, "status">[],
): { pause: boolean; resume: boolean; delete: boolean } {
  return {
    pause: rows.some((r) => r.status === "active"),
    resume: rows.some((r) => r.status === "paused"),
    delete: rows.length > 0,
  };
}

/**
 * The rows a batch status write actually has to PATCH: web's `useSetStatus`
 * skips any row already in the target status (`:107`), so pausing a selection
 * where three of five are already paused sends two requests, not five.
 *
 * Returns the rows themselves rather than ids so the caller can report counts
 * against the same objects it selected.
 */
export function autopilotStatusPlan<T extends Pick<Autopilot, "status">>(
  rows: readonly T[],
  status: "active" | "paused",
): T[] {
  return rows.filter((row) => row.status !== status);
}

/**
 * What the row's "last run" slot renders — web's `LastRunCell`
 * (`autopilots-page.tsx:343-373`) as a decision rather than JSX, because the
 * empty case is the one that goes wrong: `last_run_at` is `null` on a
 * never-run autopilot, and running it through a relative-time formatter
 * produces "Invalid Date" on screen instead of web's em dash.
 *
 * The two branches are distinct VALUES, not a nullable string, so a caller
 * cannot render a time it never got. `absent` carries no `label` at all.
 */
export type LastRunCell =
  | { kind: "absent" }
  | { kind: "run"; dotClass: string; label: string };

/**
 * `timeAgo` is injected rather than imported so this stays renderer-free and
 * the caller keeps the app's localized formatter (`lib/time-ago.ts`).
 */
export function lastRunCell(
  row: Pick<Autopilot, "last_run_at" | "last_run_status">,
  timeAgo: (iso: string) => string,
): LastRunCell {
  if (!row.last_run_at) return { kind: "absent" };
  return {
    kind: "run",
    dotClass: runStatusDotClass(row.last_run_status),
    label: timeAgo(row.last_run_at),
  };
}

/**
 * Whether the trigger slot should paint its own em dash.
 *
 * Web keeps triggers and last-run in two separate grid COLUMNS, so a row with
 * neither legitimately shows two dashes side by side and the column header
 * tells the reader which is which. A phone has no column headers: the row's
 * second line is one run of items, where `—  —` reads as a rendering fault
 * rather than as "no triggers, never ran".
 *
 * This state did not exist before this round — there was no last-run slot at
 * all — so suppressing the duplicate changes nothing that was already
 * aligned. The trigger dash still renders whenever the last-run slot carries
 * real content (its own time, or its own dash when the row never ran but HAS
 * triggers), which is every case but the double-empty one.
 */
export function showTriggerDash(
  triggerKinds: readonly string[] | undefined,
  lastRun: LastRunCell,
): boolean {
  if ((triggerKinds?.length ?? 0) > 0) return false;
  return lastRun.kind !== "absent";
}
