/**
 * Editing one column's handoff — web's `WorkflowHandoffForm` +
 * `ColumnHandoff` (`packages/views/workflows/handoff-form.tsx`,
 * `column-handoff.tsx`) as pure decisions (MUL-7420, MYS-2889 follow-up).
 *
 * ## The gap this closes
 *
 * Iterations 288–292 taught the phone to *read* the workflow: which statuses a
 * column accepts, what each column hands off to, who receives it, and the whole
 * pipeline at once. Reading is where it stopped. On the desktop an admin opens
 * a board column's badge and edits the handoff — who the column hands to, what
 * the handler is told, where the issue goes next. On the phone there was no
 * write path at all: `setWorkflowHandoff` had zero call sites, so 「每列交给谁」
 * could be seen and never changed. That is a product-semantics divergence
 * (`apps/mobile/CLAUDE.md`: "Permissions / access", "State enums /
 * transitions"), not a UI difference.
 *
 * ## Why the decisions live here
 *
 * The form's rules are dense and each one is a defect if it drifts:
 *
 *   1. **An edit to a shared workflow is not one decision.** Upstream asks
 *      where it applies — every project using the workflow, or this project
 *      only (which copies the workflow first). Which of the two is *offered*
 *      depends on permissions, on whether the workflow is shared, and on
 *      whether the draft is dirty at all. `handoffSaveScope` is that decision.
 *   2. **Only agent and squad handoffs carry instructions.** For a member
 *      handler the server ignores them, so a draft that keeps them makes the
 *      form look dirty forever and sends fields the step does not own.
 *      `savedHandoff` strips them — the exact transformation upstream applies
 *      before comparing and before saving.
 *   3. **"Dirty" must be computed on the SAVED shape.** Comparing the raw draft
 *      would report a change whenever a member handler's dead instruction text
 *      differs, enabling a Save button that writes nothing.
 *   4. **A handler kind with no target cannot be saved.** Picking 「交给智能体」
 *      and then not choosing one is a half-made choice; upstream disables Save
 *      with `needsTarget`.
 *
 * Everything here is framework-free so the Node vitest lane reaches every
 * branch; naming actors and drawing the sheet live in
 * `components/issue/workflow-handoff-editor.tsx`.
 */
import type { IssueWorkflow, IssueWorkflowStep } from "@multica/core/types";

/** The two shapes the handoff form's 「交给」 control offers. */
export type HandoffMode = "none" | "agent" | "member";

/** The fields of a step the handoff form may write. */
export type HandoffDraft = Pick<
  IssueWorkflowStep,
  "status_key" | "handler" | "instructions" | "next_status_key" | "back_status_key"
>;

/** Where a handoff edit lands: on the workflow itself, or on a copy for one
 *  project. */
export type HandoffSaveScope = "all" | "project";

/**
 * Which of the form's three 「交给」 choices a handler belongs to.
 *
 * Upstream's `modeOf` (`handoff-form.tsx:39`). The mapping is many-to-one in
 * both directions on purpose: squads are edited through the agent mode (same
 * picker, plus the squad section) and a project lead through the member mode —
 * so a step already holding either must reopen in the mode that can edit it.
 * A handler this build does not recognise falls to `none`, which is what the
 * schema's own enum degradation does (`data/schemas.ts`).
 */
export function handoffModeOf(handler: IssueWorkflowStep["handler"]): HandoffMode {
  if (handler.type === "agent" || handler.type === "squad") return "agent";
  if (handler.type === "member" || handler.type === "project_lead") return "member";
  return "none";
}

/**
 * The parts of a draft that are actually saved.
 *
 * Upstream's `savedHandoff` (`handoff-form.tsx:51`): instructions and the
 * next/back targets reach an agent's or a squad leader's brief, so for any
 * other handler they are cleared rather than merely ignored. Clearing matters
 * twice — the server stores what it is sent, and `isHandoffDirty` compares this
 * shape, so leftover text on a member step would keep the form permanently
 * dirty.
 */
export function savedHandoff(draft: HandoffDraft): HandoffDraft {
  if (draft.handler.type === "agent" || draft.handler.type === "squad") return draft;
  return {
    ...draft,
    instructions: "",
    next_status_key: undefined,
    back_status_key: undefined,
  };
}

/**
 * Whether two drafts describe the same saved handoff.
 *
 * Field-by-field rather than `JSON.stringify`: key ORDER is not part of the
 * value, and a draft rebuilt from a server response can order its keys
 * differently from one built by the form, which would make an untouched form
 * read as dirty. Absent and empty are the same for the optional keys — the
 * server drops them the same way.
 */
export function sameHandoff(a: HandoffDraft, b: HandoffDraft): boolean {
  return (
    a.handler.type === b.handler.type &&
    (a.handler.id ?? "") === (b.handler.id ?? "") &&
    a.instructions === b.instructions &&
    (a.next_status_key ?? "") === (b.next_status_key ?? "") &&
    (a.back_status_key ?? "") === (b.back_status_key ?? "")
  );
}

/**
 * Whether the draft differs from what is saved — compared on the SAVED shape
 * of both sides, which is the only comparison that means anything.
 *
 * A form that says 「有未保存的改动」 when there are none is not harmless: it
 * enables Save, and pressing it writes the same values back while telling the
 * user something changed.
 */
export function isHandoffDirty(draft: HandoffDraft, saved: HandoffDraft): boolean {
  return !sameHandoff(savedHandoff(draft), savedHandoff(saved));
}

/**
 * Whether the draft names a handler but not which one — an unsavable state.
 *
 * Upstream (`handoff-form.tsx:167`) disables Save on exactly this: the three
 * actor kinds carry an `id`, and a choice without one is half-made. Note
 * `none`, `creator` and `project_lead` legitimately have no id and are NOT
 * incomplete — deriving this from "an id is missing" would block them.
 */
export function handoffNeedsTarget(
  handler: IssueWorkflowStep["handler"],
): boolean {
  const named =
    handler.type === "agent" ||
    handler.type === "squad" ||
    handler.type === "member";
  return named && !handler.id;
}

/**
 * The step the form opens on: the workflow's own row, or an empty draft for a
 * status the workflow does not list.
 *
 * The second case is reachable — the card draws a column the workflow has since
 * dropped, or a caller opens the editor for a status from the catalog — and it
 * must not throw. Upstream builds the same fallback inline
 * (`handoff-form.tsx:161`).
 */
export function initialHandoffDraft(
  steps: readonly IssueWorkflowStep[],
  statusKey: string,
): HandoffDraft {
  const saved = steps.find((s) => s.status_key === statusKey);
  if (saved) return saved;
  return {
    status_key: statusKey,
    handler: { type: "none" },
    instructions: "",
  };
}

/**
 * Whether to ask 「这次改动应用到哪里」 before saving, and which two answers
 * to offer.
 *
 * Upstream's `askScope` (`handoff-form.tsx:169`) is a five-part conjunction and
 * every part is load-bearing:
 *
 *   - `canEdit` — a reader never saves at all, so the question is noise;
 *   - `canCopyForProject` — the project-scoped answer COPIES the workflow and
 *     switches the project to the copy, which is `canManageProject`; offering
 *     it to someone who cannot switch projects would offer a write that the
 *     server refuses with 403;
 *   - `dirty` — an unchanged draft sends nothing, so there is nothing to scope;
 *   - `!workflow.is_default` — Default belongs to the workspace, not to a
 *     project; a copy of it would be a new named workflow, which is a different
 *     action than the one this question asks about;
 *   - `others.length > 0` — with no other project using the workflow there is
 *     only one possible answer, so asking is a question with one option.
 *
 * The `project` requirement is folded in by the caller passing
 * `projectId: undefined` when there is none: the copy needs a project to switch.
 */
export function handoffAsksSaveScope(input: {
  canEdit: boolean;
  canCopyForProject: boolean;
  dirty: boolean;
  isDefaultWorkflow: boolean;
  /** Projects using the workflow OTHER than the one the form was opened from. */
  otherProjectCount: number;
  hasProject: boolean;
}): boolean {
  return (
    input.canEdit &&
    input.canCopyForProject &&
    input.dirty &&
    input.hasProject &&
    !input.isDefaultWorkflow &&
    input.otherProjectCount > 0
  );
}

/**
 * The projects using a workflow besides the one it was opened from, and the
 * label naming them.
 *
 * Upstream's `useWorkflowSharing` (`handoff-form.tsx:81`). Two rules:
 *
 *   - **Unknown projects are dropped, not numbered.** `workflow.project_ids`
 *     can name a project the caller's project list has not returned (it was
 *     deleted, or the list is paginated). Counting it would make the sentence
 *     say 「以及另外 2 个」 while naming one — a number the reader cannot
 *     reconcile with the names beside it.
 *   - **The count in the "more" phrasing is the REAL total**, not the number
 *     beyond the three shown. Upstream passes `others.length`, so
 *     「A、B、C 以及另外 5 个」 means seven projects, not eight.
 */
export function handoffSharingProjects(input: {
  projectIds: readonly string[];
  /** The project the form was opened from; excluded from the list. */
  projectId: string | undefined;
  /** The caller's project list, for id → title. */
  projects: readonly { id: string; title: string }[];
  /** How many names to spell out before summarising. */
  limit?: number;
}): { others: { id: string; title: string }[]; shown: { id: string; title: string }[]; more: number } {
  const limit = input.limit ?? 3;
  const others = input.projectIds
    .filter((id) => id !== input.projectId)
    .map((id) => input.projects.find((p) => p.id === id))
    .filter((p): p is { id: string; title: string } => !!p);
  return {
    others,
    shown: others.slice(0, limit),
    more: Math.max(0, others.length - limit),
  };
}

/**
 * The statuses the 「完成时移到 / 退回时移回」 controls may name: every other
 * column of the workflow, in workflow order.
 *
 * The step's own status is excluded (a column that sends itself nowhere) and
 * the caller renders the unset choice separately, exactly as upstream's
 * `others` does (`handoff-form.tsx:557`).
 */
export function handoffTargetStatusKeys(
  steps: readonly Pick<IssueWorkflowStep, "status_key">[],
  statusKey: string,
): string[] {
  return steps
    .map((s) => s.status_key)
    .filter((key) => key !== statusKey);
}

/**
 * The label the 「完成时移到」 control shows when nothing is set: the column the
 * workflow would use by default, so the reader learns what silence means.
 *
 * Upstream computes the default against the workflow with every explicit
 * `next_status_key` stripped (`handoff-form.tsx:388`) — that is what makes the
 * line say "the next column" rather than echo the step's own saved choice back
 * as if it were an unset default. `workflowNextStatus` is the same helper the
 * card and the brief use, so the default shown here and the destination the
 * server actually tells the handler cannot diverge.
 */
export function handoffDefaultNextStatus(
  steps: readonly IssueWorkflowStep[],
  statusKey: string,
): string {
  // Reuse the workflow's own rule rather than a second implementation: strip
  // the explicit choices, then ask where a bare step would go.
  const bare = steps.map((s) => ({ ...s, next_status_key: undefined }));
  const index = bare.findIndex((s) => s.status_key === statusKey);
  if (index < 0) return "";
  for (const s of bare.slice(index + 1)) {
    if (s.status_key !== "blocked") return s.status_key;
  }
  return "";
}

/**
 * The workflow row an edit response should replace in the cached list.
 *
 * `setWorkflowHandoff` answers with the workflow that now holds the change:
 * the same one when the scope was 「所有项目」, or a NEW copy when the scope was
 * 「只有这个项目」. The caller has to know which happened, because the copy
 * case also changed the project's `workflow_id` and every workflow's
 * `project_ids`.
 *
 * Returns `"copy"` when the answered workflow is a different row than the one
 * edited, `"same"` when it is. A missing id is `"same"`: there is nothing to
 * patch, and the caller's fallback (invalidate) covers it.
 */
export function handoffSaveResultKind(input: {
  editedWorkflowId: string;
  saved: Pick<IssueWorkflow, "id"> | null | undefined;
}): "same" | "copy" {
  if (!input.saved?.id) return "same";
  return input.saved.id === input.editedWorkflowId ? "same" : "copy";
}

/**
 * Whether a status can be edited at all: parking and closing columns never hand
 * off, so their editor is not offered (`column-handoff.tsx:44` gates on the
 * same predicate through `statusAcceptsHandoff`).
 *
 * Re-exported rather than re-derived so a caller cannot drift from
 * `lib/workflow.ts`'s own list.
 */
export { statusAcceptsHandoff } from "@/lib/workflow";
