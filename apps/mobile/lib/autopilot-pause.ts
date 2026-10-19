/**
 * Why an autopilot says "paused" (iteration 258, MYS-2236).
 *
 * `autopilot.status` and `autopilot.pause_reason` answer different questions
 * and must not be folded into one word:
 *
 *   status        user-controlled. `paused` means a person paused it (or is
 *                 about to see a switch they turned off).
 *   pause_reason  machine-readable explanation the SYSTEM attaches when it
 *                 paused the row. Only one value exists today —
 *                 `agent_runtime_required`, written by the server when a
 *                 runtime delete left the assignee without a runtime
 *                 (`server/pkg/db/queries/autopilot.sql:96,119`).
 *
 * Rendering both as 「已暂停」 is what made the state unfixable on the phone:
 * the user reads "paused", assumes they paused it, and the switch they would
 * reach for is already the one that says "active" is off. There is no way to
 * learn that the ACTUAL cause is an unbound runtime, and web says so in a
 * banner with a deep link to the agent (`autopilot-detail-page.tsx:829-848`).
 *
 * The schema already parsed the field (`data/schemas.ts:1859`); nothing read
 * it. This module is the read.
 */

import type { Autopilot } from "@multica/core/types";
import type { ActorNameState } from "@/lib/actor-name-state";

/** The only system pause reason the server emits today. Kept as a literal so
 *  a second reason is a deliberate edit here rather than a silent fallthrough
 *  to the generic sentence. */
export const PAUSE_REASON_AGENT_RUNTIME_REQUIRED = "agent_runtime_required";

/**
 * Whether this autopilot is paused BY THE SYSTEM for want of a runtime.
 *
 * Deliberately also requires `status === "paused"`: `pause_reason` is cleared
 * by every status write (`autopilot.sql:73-76`), but a client holding a stale
 * row across that write would otherwise show a banner for an autopilot that
 * is running again. Requiring both makes the banner impossible while active.
 */
export function isRuntimeRequiredPause(
  autopilot: Pick<Autopilot, "status" | "pause_reason">,
): boolean {
  return (
    autopilot.status === "paused" &&
    autopilot.pause_reason === PAUSE_REASON_AGENT_RUNTIME_REQUIRED
  );
}

/**
 * The status word for a row: a system pause gets its own sentence, everything
 * else keeps the plain status word. Web's `NameCell`
 * (`autopilots-page.tsx:255-256`) makes exactly this split for the paused
 * marker's tooltip.
 *
 * Returns an i18n KEY, or null when the plain `autopilots.status.<status>`
 * word is what should print.
 */
export function pauseStatusLabelKey(
  autopilot: Pick<Autopilot, "status" | "pause_reason">,
): string | null {
  return isRuntimeRequiredPause(autopilot)
    ? "autopilots.status.pausedRuntimeRequired"
    : null;
}

/**
 * Whether the detail page should offer the "bind runtime" jump. Web gates the
 * link on the assignee being an AGENT (`autopilot-detail-page.tsx:836`): a
 * squad's runtime is its leader's, so the link would have to pick a leader —
 * the banner still explains, it just does not promise a destination that does
 * not exist.
 */
export function canJumpToRuntimeBinding(
  autopilot: Pick<Autopilot, "assignee_type">,
): boolean {
  return autopilot.assignee_type === "agent";
}

/**
 * The route a "bind runtime" tap should land on.
 *
 * The agent detail screen hosts the runtime binding as an editable property,
 * and its edit route is where the field is actually changed
 * (`more/agents/[id]/edit.tsx` → `ManualAgentForm` → `RuntimePickerSheet`).
 * Web sends the reader to `agentDetail(id)?view=general`; the phone has no
 * `view` tab param, so this goes straight to the form that owns the control
 * instead of to a review surface one tap short of the fix.
 */
export function runtimeBindingHref(
  workspaceSlug: string,
  agentId: string,
): string {
  return `/${workspaceSlug}/more/agents/${agentId}/edit`;
}

/**
 * The banner sentence for a runtime-required pause.
 *
 * Names the assignee only when the directory has actually answered
 * (`actor-name-state.ts`'s rule: a name is a fact, and an unsettled read may
 * not assert one). An unsettled or failed read falls back to the unnamed
 * sentence — the explanation still holds, it just does not promise which
 * actor it is about. Web has no such branch because it renders the banner
 * from a loaded member/agent context; mobile's directories arrive late and
 * independently.
 *
 * Returns an i18n key plus the params to interpolate.
 */
export function pauseBannerCopy(
  assignee: ActorNameState,
): { key: string; params?: { name: string } } {
  return assignee.kind === "name"
    ? {
        key: "autopilots.detail.pausedRuntimeRequired",
        params: { name: assignee.name },
      }
    : { key: "autopilots.detail.pausedRuntimeRequiredUnnamed" };
}
