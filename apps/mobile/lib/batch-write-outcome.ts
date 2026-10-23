/**
 * What to tell the user after a batch write, and what to do with the selection
 * (web parity with `batch-action-toolbar.tsx`, MUL-8179).
 *
 * ## The defect this exists for
 *
 * `POST /api/issues/batch-update` does not promise "all or nothing". Its
 * handler (`server/internal/handler/issue.go` `BatchUpdateIssues`) walks
 * `issue_ids` and `continue`s past every issue it cannot act on — a row
 * deleted between the list render and the tap (`GetIssueInWorkspace` fails), a
 * stage below 1, a parent that would create a cycle, a project outside the
 * workspace — and then answers `{"updated": N}` with the count it actually
 * committed. `batch-delete` is the same shape (`{"deleted": N}`).
 *
 * Mobile used to ignore those counts entirely: it read a 200 as "every row
 * applied", announced `batch.updateSuccess` with the size of the SELECTION, and
 * cleared the selection. So a partial write told the user "已更新 5 个任务"
 * when two had applied, and dropped the three that had not, leaving no way to
 * retry them — a claim the server never made, on top of lost work. That is the
 * same class of defect as the earlier "queued run reported as working" and
 * "unreadable failure reason reported as Failed" rounds: an unverified
 * statement presented as fact.
 *
 * ## The unreadable-count case is NOT a partial case
 *
 * The mobile client parses every response through `parseWithFallback`, so a
 * schema drift yields the fallback object rather than throwing. If the fallback
 * carried `updated: 0`, a successful batch write during a server/client drift
 * would be announced as "updated 0 of 5" — a false alarm manufactured by the
 * client. The count is therefore `number | null`, `null` meaning "the server
 * did not give us a number we could read", and `null` never produces a partial
 * verdict: there is nothing to compare, so nothing is claimed.
 */

/**
 * `all` — the server committed every requested row.
 * `partial` — the server committed some but reported fewer than requested.
 * `unknown` — no count could be read, so no count-shaped claim is made.
 */
export type BatchWriteOutcome = "all" | "partial" | "unknown";

/** Bar-toast tone. Mobile has no toast infra; the bar keeps its own, and this
 *  is the vocabulary `lib/autopilot-run-toast.ts` already uses. */
export type BatchToastKind = "success" | "warning" | "error";

/**
 * Whether the selection survives a successful write.
 *
 * `keep` — leave it alone so the next edit can be chained (web's default for
 * full-screen lists: same rows, several edits).
 * `exit` — leave selection mode entirely (web's `clearSelectionOnApply`, used
 * by the sub-issue list). Mobile needs the stronger verb: its list rows render
 * checkboxes off a store-level `selectionMode` that `clear()` deliberately
 * leaves on, so clearing membership alone would hide the bar while leaving
 * every row in "tap to select" mode — a surface with no visible exit.
 */
export type BatchSelectionAfter = "keep" | "exit";

/**
 * Compare the server's committed count against what the caller asked for.
 *
 * `applied` is `null` when the response carried no count the client could
 * read; that is reported as `unknown`, never as `partial` (see the module
 * note). A count GREATER than the request is not a partial write — it is
 * nonsense, and the safe reading is that everything applied.
 */
export function batchWriteOutcome(
  requested: number,
  applied: number | null,
): BatchWriteOutcome {
  if (applied === null) return "unknown";
  if (!Number.isFinite(applied)) return "unknown";
  return applied < requested ? "partial" : "all";
}

/**
 * The selection after a write. A partial write always KEEPS it: the rows the
 * server skipped are the ones the user still needs to act on, and clearing
 * would erase the only handle on them (web: "a partial or failed write keeps
 * the selection so the user can retry"). `unknown` keeps it too — an unreadable
 * count is not evidence that anything was dropped.
 */
export function batchSelectionAfter(
  outcome: BatchWriteOutcome,
  oneShot: boolean,
): BatchSelectionAfter {
  if (outcome !== "all") return "keep";
  return oneShot ? "exit" : "keep";
}

/**
 * Toast tone for a settled write. Partial is a warning, not an error: the bar
 * DID change rows, and a destructive-red surface would read as "nothing
 * happened". Failures never reach this function — they are `error` at the
 * call site, where the thrown error is in hand.
 */
export function batchToastKind(outcome: BatchWriteOutcome): BatchToastKind {
  return outcome === "partial" ? "warning" : "success";
}
