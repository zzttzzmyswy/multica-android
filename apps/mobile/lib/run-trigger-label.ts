/**
 * What a run row says caused this run — the mobile port of web's
 * `task-run-labels.ts` + `wakeup-source-chip.tsx` pair
 * (`packages/views/issues/components/`).
 *
 * The problem both files solve: a run started by a wakeup rule carries the
 * rule's INSTRUCTION as its `trigger_summary`, so it reads like a task someone
 * typed. Web therefore (a) labels such a run "Triggered by wakeup" instead of
 * quoting that instruction, and (b) when the issue still has the rule, upgrades
 * the label to "Wakeup · <condition>" naming what the rule was watching.
 *
 * Mobile had neither: `run-row.tsx` rendered `trigger_summary ??
 * fallbackSummary(...)` and never looked at `wakeup_id`, even though the
 * schema has parsed the field since MYS-2023. On a phone a rule-driven retry
 * and a hand-pressed retry were the same row — which is exactly the fact a
 * reader needs to decide whether the RULE needs changing.
 *
 * Deliberate deviations from web, each noted at its site:
 *  - the decision is a pure function of `(task, rule, text)` rather than a
 *    component with a `render` callback, so the Node lane can test the branch
 *    (`web`'s render prop exists because its label is a styled `<span>`;
 *    mobile's is a string inside a `<Text>`).
 *  - no `enabled`-less lookup: the rule read is gated on `wakeup_id`, and it
 *    shares the issue's rule cache with the wakeup section
 *    (`data/queries/issue-wakeups.ts`), so N wakeup rows cost one request.
 */
import type { AgentTask, WakeupPreview } from "@multica/core/types";
import { wakeupTrigger, type WakeupTextDeps } from "./wakeup-presentation";

/**
 * What caused a run, as one line.
 *
 * Precedence is web's (`task-run-labels.ts:28-55`): a wakeup run says so
 * rather than quoting the rule's instruction — the instruction is what the
 * agent was told to do, not why it ran, and on a row that already shows the
 * agent's name it reads as a second instruction.
 *
 * `trigger_summary` still wins for every other run: it is the canonical
 * snapshot taken at creation time and survives edits/deletes of its source.
 */
export function runTriggerLabel(
  task: Pick<AgentTask, "wakeup_id" | "trigger_summary" | "kind">,
  t: (id: string) => string,
): string {
  if (task.wakeup_id) return t("runs.triggeredByWakeup");
  const snapshot = task.trigger_summary?.trim();
  if (snapshot) return snapshot;
  return kindLabel(task.kind, t);
}

/** The structural fallback for a run with no stored summary. */
export function kindLabel(
  kind: AgentTask["kind"],
  t: (id: string) => string,
): string {
  switch (kind) {
    case "comment":
      return t("runs.kind.comment");
    case "autopilot":
      return t("runs.kind.autopilot");
    case "chat":
      return t("runs.kind.chat");
    case "quick_create":
      return t("runs.kind.quickCreate");
    case "direct":
    default:
      return t("runs.kind.task");
  }
}

/**
 * The label a wakeup run's row shows, given whatever the rule read returned.
 *
 * `rule` is `undefined` in two different situations and both must land on the
 * same text: the rule was deleted (runs outlive rules), or the read has not
 * answered yet. Rendering "Wakeup · " with an empty condition — what a naive
 * template does — would be a sentence with its object missing, so the fallback
 * is the whole label, not a truncated one.
 *
 * That fallback is `runTriggerLabel`'s answer for the same task ("Triggered by
 * wakeup"), which is also what web passes as `fallback`
 * (`wakeup-source-chip.tsx:58-66`).
 */
export function wakeupRunLabel(
  deps: WakeupTextDeps,
  rule: WakeupPreview | undefined,
  fallback: string,
): string {
  if (!rule) return fallback;
  return deps.t("runs.triggerWakeup", { condition: wakeupTrigger(deps, rule) });
}
