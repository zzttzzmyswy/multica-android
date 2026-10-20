/**
 * What the agent-detail Skills section opens when a row is tapped.
 *
 * Web's `skills-tab.tsx` keeps a discriminated `SelectedSkill`:
 *
 *   { kind: "workspace", id }        // `:178` — assigned workspace skill
 *   { kind: "runtime",   skill }     // `:295` — inherited runtime-local skill
 *
 * and one `SkillDetailDialog` branches on it (`:435-497`): a workspace skill
 * renders `content` (the SKILL.md markdown) plus its supporting `files`; a
 * runtime skill renders `source_path` / `provider` / `plugin` / `file_count`
 * and has NO content — the daemon summary never carries it.
 *
 * The two are not interchangeable, which is why this is a real decision and
 * not a formatting detail:
 *
 *  - A workspace skill has an id the `/api/skills/:id` endpoint accepts, so
 *    its detail is a READ. Mobile can fetch it on demand (the list endpoint
 *    deliberately omits `content`, GH multica-ai/multica#2174).
 *  - A runtime skill exists only on somebody's disk; the id mobile holds is a
 *    discovery key (`runtimeSkillIdentity`), not a workspace skill id. Passing
 *    it to `skillDetailOptions` would 404. Its whole detail is already in the
 *    summary the runtime-capabilities read returned, so there is nothing to
 *    fetch.
 *
 * Mobile also has a full skills screen (`/more/skills/[id]`) with editing, file
 * trees and refresh. Reusing it for the workspace case would be wrong here:
 * this is a read-only peek from inside an agent, and navigating away from the
 * agent page (and back) is exactly the friction the row tap is meant to
 * remove. A sheet keeps the context.
 */

import type { RuntimeLocalSkillSummary } from "@multica/core/types";

/** The selected row, discriminated exactly as web's `SelectedSkill` is. */
export type SelectedAgentSkill =
  | { kind: "workspace"; id: string }
  | { kind: "runtime"; skill: RuntimeLocalSkillSummary }
  | null;

/**
 * What a tap on an assigned workspace skill should open.
 *
 * Takes only the id rather than the full `SkillSummary`: the agent's
 * `agent.skills` rows are the narrower `AgentSkillSummary` (an assignment
 * record), which carries an id but not the workspace columns. Structural input
 * keeps both call shapes legal.
 *
 * Returns `null` for a row with no id — a defensive branch, since every
 * assigned skill has one, but a sheet opened on `undefined` would fetch
 * `/api/skills/undefined` and show its 404 as though the skill had been
 * deleted.
 */
export function workspaceSkillSelection(skill: { id?: string }): SelectedAgentSkill {
  if (!skill.id) return null;
  return { kind: "workspace", id: skill.id };
}

/**
 * What a tap on a runtime-local skill should open.
 *
 * Unlike the workspace case this cannot fail for lack of an id: the summary
 * object IS the detail. Returns `null` only for a nullish skill, so the caller
 * has one uniform "nothing to open" value.
 */
export function runtimeSkillSelection(
  skill: RuntimeLocalSkillSummary | null | undefined,
): SelectedAgentSkill {
  if (!skill) return null;
  return { kind: "runtime", skill };
}

/** Which body the detail sheet renders. Split out so the branch is testable
 *  and the component holds no conditional logic of its own. */
export type SkillDetailView =
  /** Workspace skill — show a spinner until the content read settles. */
  | { kind: "workspace-loading" }
  /** Workspace skill content, ready. `content` may legitimately be empty. */
  | { kind: "workspace"; content: string; files: { id: string; path: string }[] }
  /** Workspace skill read failed — name the failure, do not render it as empty. */
  | { kind: "workspace-error" }
  /** Runtime skill — the summary's own fields, no read involved. */
  | {
      kind: "runtime";
      sourcePath: string;
      provider: string;
      plugin: string | null;
      fileCount: number;
    };

/**
 * Build the sheet's body for a selection.
 *
 * The workspace branch takes the ALREADY-RESOLVED read state rather than a
 * query object so this stays pure. Three states, never collapsed:
 *
 *  - `loading`  → spinner. A read still in flight is not "no content".
 *  - `failed`   → named failure. This is the MYS-1908/2510 rule the rest of
 *                 the app follows: a failed read may not be rendered as the
 *                 absence of the thing.
 *  - `ready`    → the content, even when it is an empty string (an empty
 *                 SKILL.md is a real, legal state).
 */
export function skillDetailView(
  selection: SelectedAgentSkill,
  workspaceRead:
    | { state: "loading" }
    | { state: "failed" }
    | {
        state: "ready";
        skill: {
          content: string;
          files?: { id: string; path: string }[];
        };
      },
): SkillDetailView | null {
  if (!selection) return null;
  if (selection.kind === "runtime") {
    return {
      kind: "runtime",
      sourcePath: selection.skill.source_path,
      provider: selection.skill.provider,
      plugin: selection.skill.plugin ?? null,
      fileCount: selection.skill.file_count,
    };
  }
  if (workspaceRead.state === "loading") return { kind: "workspace-loading" };
  if (workspaceRead.state === "failed") return { kind: "workspace-error" };
  return {
    kind: "workspace",
    content: workspaceRead.skill.content,
    files: workspaceRead.skill.files ?? [],
  };
}

/** Title for the sheet header. Web prefers the runtime skill's own name, falls
 *  back to the workspace skill's (`skills-tab.tsx:436`). */
export function skillDetailTitle(
  selection: SelectedAgentSkill,
  workspaceName: string | null,
  fallback: string,
): string {
  // No selection means the sheet is closing (or never opened): there is no
  // row to name, so a stale `workspaceName` from the previous open must not
  // retitle it.
  if (!selection) return fallback;
  if (selection.kind === "runtime") return selection.skill.name || fallback;
  return workspaceName || fallback;
}
