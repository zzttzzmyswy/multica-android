/**
 * Managing workflows — create, rename, add/remove/reorder columns, delete.
 * The pure decisions behind mobile's port of web's `WorkflowEditorPage`
 * (`packages/views/workflows/workflow-editor-page.tsx`, MUL-7420) and
 * `WorkflowsTab` (`workflows-tab.tsx`).
 *
 * ## The gap this closes
 *
 * Iterations 288–293 taught the phone to READ a pipeline and, last round, to
 * change 「每列交给谁」 on an existing one. Everything else in the 「管」 half was
 * still desktop-only: no create, no rename, no description, no adding or
 * removing a column, no reordering, no delete — `createIssueWorkflow` /
 * `updateIssueWorkflow` / `deleteIssueWorkflow` had ZERO call sites in
 * `apps/mobile`. A phone user could not build a pipeline at all, while a web
 * user in the same workspace could. That is a product-semantics divergence
 * (`apps/mobile/CLAUDE.md` — "Permissions / access", "State enums /
 * transitions"), not a UI difference.
 *
 * ## The four rules that are defects if they drift
 *
 * 1. **Fixed columns are placed by the SERVER, and the client must not
 *    re-derive their order.** Backlog and todo sit at the head, blocked, done
 *    and cancelled at the tail, and the server re-adds todo/done/cancelled
 *    when a write omits them (`issueworkflow.Arrange`). {@link boardColumns}
 *    is therefore the single place the draft is put in board order, and it
 *    does so by pinning the fixed keys rather than trusting the middle array —
 *    a draft that sorted its own middle and kept whatever position a fixed key
 *    happened to hold would show one order before the save and another one
 *    after the refresh.
 *
 * 2. **An edit that drops a column must be previewed before it is written.**
 *    The server refuses such a write with `409
 *    workflow_status_mapping_required` and a plan naming every status whose
 *    issues have nowhere to go. Sending the PATCH first means the user meets
 *    that refusal with no idea which statuses are involved — the same contract
 *    iteration 269 established for project switches, and
 *    {@link saveNeedsDryRun} is where the phone decides to ask first.
 *
 * 3. **Only columns that accept a handoff get a handoff editor.** backlog,
 *    done and cancelled never reassign an issue. `statusAcceptsHandoff`
 *    (`lib/workflow.ts`) is reused rather than re-listed here, so the two
 *    cannot disagree.
 *
 * 4. **Creating and editing are two permissions.** Any member creates a
 *    workflow (`canCreateWorkflow`); only its owner or a workspace admin edits
 *    or deletes one (`canEditWorkflow`). Judging both by one predicate gets
 *    one of the two answers wrong for every plain member.
 *
 * Everything here is framework-free so the Node vitest lane reaches every
 * branch; labels, icons and sheets live in
 * `components/workflow/workflow-editor-screen.tsx`.
 */
import type {
  IssueWorkflow,
  IssueWorkflowStep,
  IssueWorkflowStepInput,
  IssueWorkflowWriteRequest,
} from "@multica/core/types";
import { savedHandoff } from "@/lib/workflow-handoff-edit";
import { workflowMiddleKeys } from "@/lib/workflow";

/** A column that cannot be removed and keeps its place: todo, done, cancelled
 *  always; backlog and blocked when switched on. */
const PINNED_HEAD = ["backlog", "todo"] as const;
const PINNED_TAIL = ["blocked", "done", "cancelled"] as const;
/** The two fixed statuses a workflow may leave out. */
const OPTIONAL_FIXED = new Set<string>(["backlog", "blocked"]);

/** A middle column of a draft: a status from the library, or one the save
 *  creates. */
export type DraftColumn =
  | { id: string; status_key: string }
  | { id: string; new_name: string; category?: "unstarted" | "started" };

/** What entering a column does, keyed in the draft by column id. */
export type DraftHandoff = Pick<
  IssueWorkflowStep,
  "handler" | "instructions" | "next_status_key" | "back_status_key"
>;

export const NO_HANDOFF: DraftHandoff = { handler: { type: "none" }, instructions: "" };

/**
 * The editor's whole working state. `middle` is the only part the user orders;
 * `backlog` / `blocked` are switches and the rest of the columns are implied.
 */
export interface WorkflowDraft {
  name: string;
  description: string;
  backlog: boolean;
  blocked: boolean;
  middle: DraftColumn[];
  handoffs: Record<string, DraftHandoff>;
}

/** A new workflow starts from the common delivery loop, not from nothing. */
export const NEW_WORKFLOW_MIDDLE = ["in_progress", "in_review"] as const;

/** Maximum name length the server accepts (`issueworkflow.MaxNameRunes`). */
export const WORKFLOW_NAME_MAX = 64;
/** Maximum description length (`issueworkflow.MaxDescriptionRunes`). */
export const WORKFLOW_DESCRIPTION_MAX = 256;

/**
 * The key a column goes by in the editor: its status, or — for a status the
 * save creates — its draft id, so its handoff can be edited before the save.
 */
export function columnKey(column: DraftColumn): string {
  return "status_key" in column ? column.status_key : column.id;
}

/** Whether a draft handoff says anything worth keeping. */
export function hasHandoff(handoff: DraftHandoff | undefined): handoff is DraftHandoff {
  return (
    !!handoff &&
    (handoff.handler.type !== "none" ||
      !!handoff.next_status_key ||
      !!handoff.back_status_key)
  );
}

/** The handoff a column shows, empty when it has none. */
export function draftHandoff(
  draft: WorkflowDraft,
  id: string,
): DraftHandoff {
  return draft.handoffs[id] ?? NO_HANDOFF;
}

/**
 * The draft a saved workflow opens as.
 *
 * Only handoffs that say something are carried into `handoffs`: an entry of
 * `{handler: none, instructions: ""}` for every column would make the map
 * depend on the workflow's own key order and compare unequal to itself after a
 * round-trip (`sameDraft` is structural).
 */
export function draftFrom(workflow: Pick<IssueWorkflow, "name" | "description" | "steps">): WorkflowDraft {
  const keys = workflow.steps.map((s) => s.status_key);
  const handoffs: Record<string, DraftHandoff> = {};
  for (const step of workflow.steps) {
    const handoff: DraftHandoff = {
      handler: step.handler,
      instructions: step.instructions,
      next_status_key: step.next_status_key,
      back_status_key: step.back_status_key,
    };
    if (hasHandoff(handoff)) handoffs[step.status_key] = handoff;
  }
  return {
    name: workflow.name,
    description: workflow.description,
    backlog: keys.includes("backlog"),
    blocked: keys.includes("blocked"),
    middle: workflowMiddleKeys(workflow).map((key) => ({ id: key, status_key: key })),
    handoffs,
  };
}

/** The draft a 「新建」 action opens: the delivery loop, both optional columns on. */
export function newWorkflowDraft(): WorkflowDraft {
  return {
    name: "",
    description: "",
    backlog: true,
    blocked: true,
    middle: NEW_WORKFLOW_MIDDLE.map((key) => ({ id: key, status_key: key })),
    handoffs: {},
  };
}

/**
 * Every column of the draft in BOARD order.
 *
 * This is the one place ordering is decided. Pinned statuses come from the
 * head/tail constants and the middle is spliced between them, so a fixed key
 * that somehow ended up in `middle` cannot move — it is filtered out below
 * rather than rendered twice.
 */
export function boardColumns(draft: WorkflowDraft): { id: string; status_key: string }[] {
  const fixed = (key: string) => ({ id: key, status_key: key });
  // A fixed key that ended up in `middle` (a replaced column switched to a
  // fixed status, or a draft built by hand) is dropped rather than rendered a
  // second time in the wrong place: the pinned ends are the server's answer.
  // A NEW column's key is its draft id (`new:<name>`), never a fixed status,
  // so it always survives this filter.
  const middle = draft.middle
    .filter((c) => !isPinnedStatus(columnKey(c)))
    .map((c) => ({ id: c.id, status_key: columnKey(c) }));
  return [
    ...(draft.backlog ? [fixed("backlog")] : []),
    fixed("todo"),
    ...middle,
    ...(draft.blocked ? [fixed("blocked")] : []),
    fixed("done"),
    fixed("cancelled"),
  ];
}

/** The columns between the pinned ends, as the draft holds them. */
export function middleColumns(draft: WorkflowDraft): DraftColumn[] {
  return draft.middle;
}

/**
 * Whether two drafts describe the same edit. Structural on purpose: the dirty
 * flag gates the save button, and a comparison that ignored a field would let
 * the user change that field and see nothing to save.
 */
export function sameDraft(a: WorkflowDraft, b: WorkflowDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Whether there is anything to write.
 *
 * A NEW workflow (`workflowId === null`) is always dirty: it exists only as a
 * draft, so 「保存」 must be live as soon as the name is filled in.
 */
export function isDraftDirty(
  workflowId: string | null,
  draft: WorkflowDraft,
  baseline: WorkflowDraft,
): boolean {
  return !workflowId || !sameDraft(draft, baseline);
}

/**
 * Whether to SAY 「有未保存的改动」.
 *
 * Deliberately not `isDraftDirty`. A new workflow is dirty from the moment it
 * opens — that is what keeps 「创建」 enabled — but telling the reader it has
 * unsaved changes before they have touched anything is noise that describes the
 * screen rather than their work. Web makes the same split: its dirty flag drives
 * the button, while the sentence is rendered only for `workflowId && dirty`
 * (`workflow-editor-page.tsx:457`).
 */
export function showsUnsavedNote(input: {
  isNew: boolean;
  dirty: boolean;
  canEdit: boolean;
}): boolean {
  return input.canEdit && input.dirty && !input.isNew;
}

/**
 * The statuses a save may name in a handoff's next/back: every column that
 * exists BEFORE the save. A column the save creates has no key yet — its draft
 * id (`new:<name>`) is not a status — so naming it would send the server a
 * step that does not exist.
 */
export function listedStatusKeys(draft: WorkflowDraft): string[] {
  return boardColumns(draft)
    .map((c) => c.status_key)
    .filter((key) => !key.startsWith("new:"));
}

/**
 * The draft as a workflow-shaped definition, in board order, for computing the
 * default next status over the UNSAVED draft — which is the order the server
 * resolves it in once the draft is saved.
 *
 * The steps carry a `none` handler because that is the only shape
 * `workflowNextStatus` reads through; the statuses are what matter here.
 */
export function draftFlow(draft: WorkflowDraft): Pick<IssueWorkflow, "steps"> {
  return {
    steps: boardColumns(draft).map((c) => ({
      status_key: c.status_key,
      handler: { type: "none" as const },
      instructions: "",
    })),
  };
}

/**
 * The statuses a 「添加列」 list may offer: not a fixed one, and not already a
 * column.
 *
 * `catalogKeys` arrives in the catalog's own display order; this only filters,
 * so a caller cannot accidentally re-sort the library.
 */
export function addableStatusKeys(
  catalogKeys: readonly string[],
  draft: WorkflowDraft,
): string[] {
  const used = new Set(draft.middle.map(columnKey));
  return catalogKeys.filter((key) => {
    if (PINNED_HEAD.includes(key as "todo") || PINNED_TAIL.includes(key as "done")) return false;
    return !used.has(key);
  });
}

/** Whether a status is one of the fixed columns (and therefore not addable). */
export function isPinnedStatus(key: string): boolean {
  return (
    PINNED_HEAD.includes(key as "todo") || PINNED_TAIL.includes(key as "done")
  );
}

/** Whether a fixed status may be left out of a workflow. */
export function isOptionalPinnedStatus(key: string): boolean {
  return OPTIONAL_FIXED.has(key);
}

/**
 * Appends a library status as a middle column.
 *
 * Idempotent: a status already listed (or one of the pinned ends) leaves the
 * draft untouched. The 「添加列」 list cannot offer such a key
 * ({@link addableStatusKeys}), so this only matters for a caller that reached
 * past it — and a duplicated step is a workflow the server stores with the
 * same column twice.
 */
export function addStatusColumn(draft: WorkflowDraft, key: string): WorkflowDraft {
  if (isPinnedStatus(key)) return draft;
  if (draft.middle.some((c) => columnKey(c) === key)) return draft;
  return { ...draft, middle: [...draft.middle, { id: key, status_key: key }] };
}

/**
 * Appends a column for a status the save will create.
 *
 * The draft id is `new:<name>` rather than a timestamp: two columns with the
 * same name would collide on save anyway (the server reuses the first status
 * of that name), and a stable id keeps the draft comparable, so pressing
 * 「撤销」 back to the baseline actually reads as clean.
 */
export function addNewStatusColumn(
  draft: WorkflowDraft,
  name: string,
  category?: "unstarted" | "started",
): WorkflowDraft {
  const trimmed = name.trim();
  if (!trimmed) return draft;
  const id = `new:${trimmed}`;
  return {
    ...draft,
    middle: [...draft.middle, { id, new_name: trimmed, ...(category ? { category } : {}) }],
  };
}

/** Removes one middle column, and any handoff drafted for it. */
export function removeColumn(draft: WorkflowDraft, id: string): WorkflowDraft {
  const { [id]: _dropped, ...handoffs } = draft.handoffs;
  return {
    ...draft,
    middle: draft.middle.filter((c) => c.id !== id),
    handoffs,
  };
}

/**
 * Moves a middle column one place up (`-1`) or down (`+1`), stopping at the
 * ends.
 *
 * Up/down rather than drag-and-drop: every list this app lets a member order
 * does it with the same two buttons (`more/settings/issue-statuses.tsx`), and a
 * drag list inside a scrolling form fights the scroll. Only the MIDDLE moves —
 * the pinned columns are the server's to place (rule 1).
 */
export function moveColumn(draft: WorkflowDraft, id: string, delta: -1 | 1): WorkflowDraft {
  const index = draft.middle.findIndex((c) => c.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= draft.middle.length) return draft;
  const middle = [...draft.middle];
  const [moved] = middle.splice(index, 1);
  middle.splice(target, 0, moved!);
  return { ...draft, middle };
}

/** Points a middle column at a different library status, keeping its handoff. */
export function replaceColumnStatus(
  draft: WorkflowDraft,
  id: string,
  statusKey: string,
): WorkflowDraft {
  const { [id]: moved, ...rest } = draft.handoffs;
  return {
    ...draft,
    middle: draft.middle.map((c) =>
      c.id === id ? { id: statusKey, status_key: statusKey } : c,
    ),
    handoffs: moved ? { ...rest, [statusKey]: moved } : rest,
  };
}

/** Patches one column's handoff, creating it from the empty value when absent. */
export function patchHandoff(
  draft: WorkflowDraft,
  id: string,
  patch: Partial<DraftHandoff>,
): WorkflowDraft {
  return {
    ...draft,
    handoffs: { ...draft.handoffs, [id]: { ...draftHandoff(draft, id), ...patch } },
  };
}

/** Switches backlog or blocked on or off. */
export function toggleOptionalColumn(
  draft: WorkflowDraft,
  key: "backlog" | "blocked",
  on: boolean,
): WorkflowDraft {
  return { ...draft, [key]: on };
}

/**
 * The statuses a save would CREATE that this caller may not create.
 *
 * Statuses are shared by every board, so only workspace admins add them
 * (`server/internal/handler/issue_workflow.go` — `status_create_forbidden`).
 * A plain member may still build a workflow out of the existing library, so
 * this is a save-blocking list rather than a hidden affordance: naming the
 * statuses is what tells them what to ask an admin for.
 */
export function missingStatusNames(draft: WorkflowDraft, canCreateStatus: boolean): string[] {
  if (canCreateStatus) return [];
  return draft.middle.flatMap((c) => ("new_name" in c ? [c.new_name] : []));
}

/** Whether the save button may fire. */
export function canSaveDraft(input: {
  canEdit: boolean;
  dirty: boolean;
  name: string;
  pending: boolean;
  missingStatuses: readonly string[];
}): boolean {
  return (
    input.canEdit &&
    input.dirty &&
    input.name.trim().length > 0 &&
    !input.pending &&
    input.missingStatuses.length === 0
  );
}

/**
 * The write body for the draft.
 *
 * Mirrors upstream's `save` (`workflow-editor-page.tsx:301-322`) point by
 * point:
 *
 *   - steps come from {@link boardColumns}, so the order sent is the order the
 *     board shows and the server's own arrangement is a no-op;
 *   - a handoff is reduced to `savedHandoff` first — a member handler stores no
 *     instructions, and leftover text would be written on every save;
 *   - next/back survive only when they name a status this write lists;
 *   - a new column carries `new_status` with its name (and category);
 *   - `name` is omitted for Default — the server ignores it there
 *     (`issue_workflow.go:706`), and sending it would read as "renamed".
 */
export function buildWriteRequest(input: {
  draft: WorkflowDraft;
  isDefault: boolean;
  statusMapping?: Record<string, string>;
}): IssueWorkflowWriteRequest {
  const { draft, isDefault, statusMapping } = input;
  const columns = boardColumns(draft);
  const listed = new Set(listedStatusKeys(draft));

  const steps: IssueWorkflowStepInput[] = columns.map((column) => {
    const draftValue = draft.handoffs[column.id];
    // `savedHandoff` takes a full step; it only reads the handoff fields, and
    // the status key it carries back is discarded below.
    const saved = draftValue
      ? savedHandoff({ ...draftValue, status_key: column.status_key })
      : undefined;
    const handoff = hasHandoff(saved)
      ? {
          ...(saved.handler.type !== "none"
            ? { handler: saved.handler, instructions: saved.instructions }
            : {}),
          ...(saved.next_status_key && listed.has(saved.next_status_key)
            ? { next_status_key: saved.next_status_key }
            : {}),
          ...(saved.back_status_key && listed.has(saved.back_status_key)
            ? { back_status_key: saved.back_status_key }
            : {}),
        }
      : {};
    const draftColumn = draft.middle.find((c) => c.id === column.id);
    if (draftColumn && "new_name" in draftColumn) {
      return {
        new_status: {
          name: draftColumn.new_name,
          ...(draftColumn.category ? { category: draftColumn.category } : {}),
        },
        ...handoff,
      };
    }
    return { status_key: column.status_key, ...handoff };
  });

  return {
    ...(isDefault ? {} : { name: draft.name.trim() }),
    description: draft.description.trim(),
    steps,
    ...(statusMapping ? { status_mapping: statusMapping } : {}),
  };
}

/**
 * Whether the save must run a dry run first, because it drops a status.
 *
 * Three cases, and only the third needs the preview:
 *
 *   - **create** — no saved row, so nothing can be stranded;
 *   - **Default** — it accepts every status, so an edit moves no issue
 *     (`issue_workflow.go:760`: `if !current.IsDefault && len(projectIDs) > 0`);
 *   - **a named workflow whose draft no longer lists a saved status** — issues
 *     of its projects may still be on it, and the server will answer 409
 *     naming each one.
 *
 * The check is on the KEY SET, not on the button that removed it: switching
 * `blocked` off removes a status exactly as deleting a middle column does.
 */
export function saveNeedsDryRun(input: {
  saved: Pick<IssueWorkflow, "is_default" | "steps"> | null | undefined;
  draft: WorkflowDraft;
}): boolean {
  const { saved, draft } = input;
  if (!saved || saved.is_default) return false;
  const kept = new Set(boardColumns(draft).map((c) => c.status_key));
  return saved.steps.some((step) => !kept.has(step.status_key));
}

/**
 * Whether deleting this workflow is refused before the request is even sent.
 *
 * The server answers `409 workflow_in_use` when any project still names the
 * workflow, and `400 workflow_is_default` for Default
 * (`issue_workflow.go:855-880`). Both are statically knowable on the client —
 * Default by its flag, in-use by the `project_ids` the list already carries —
 * so the phone disables the action and says why, instead of offering a delete
 * whose only possible outcome is a refusal.
 */
export function deleteBlocked(input: {
  workflow: Pick<IssueWorkflow, "is_default" | "project_ids"> | null | undefined;
}): { blocked: boolean; reason: "default" | "in_use" | null } {
  const workflow = input.workflow;
  if (!workflow) return { blocked: true, reason: null };
  if (workflow.is_default) return { blocked: true, reason: "default" };
  if (workflow.project_ids.length > 0) return { blocked: true, reason: "in_use" };
  return { blocked: false, reason: null };
}

/**
 * The projects a workflow row says it serves, as the list page's usage line.
 *
 * Default is the one case where membership cannot be read off `project_ids`:
 * it collects every project naming no workflow. Same split as
 * `workflowsProjectNames` (`lib/project-workflow.ts`), narrowed to the ids so
 * a caller can render counts without holding titles.
 */
export function usageProjectIds(
  workflow: Pick<IssueWorkflow, "is_default" | "project_ids">,
  projects: readonly { id: string; workflow_id?: string | null }[] | undefined,
): string[] {
  if (!projects) return [];
  return projects
    .filter((p) => (workflow.is_default ? !p.workflow_id : workflow.project_ids.includes(p.id)))
    .map((p) => p.id);
}

/**
 * The columns a workflow row's chain shows — web's `StepChain` filter
 * (`workflows-tab.tsx:387`).
 *
 * ## Why this is not "drop the last two chips"
 *
 * Web writes `s.status_key !== "blocked" && catalog.categoryOf(s.status_key) !==
 * "closed"`, and the two category vocabularies do NOT line up with this app's:
 *
 *   - web's category set is the four LIFECYCLE values
 *     (`unstarted`/`started`/`done`/`closed`), where `done` normalizes to
 *     `"done"` and `cancelled` to `"closed"`;
 *   - this app's catalog uses the seven-value compatibility set, where the keys
 *     ARE the categories (`done` → `"done"`, `cancelled` → `"cancelled"`).
 *
 * So `!== "closed"` drops exactly ONE end state on web — cancelled — and KEEPS
 * done. Transcribing the filter by status name instead ("drop done and
 * cancelled") silently loses a chip that web shows, which is why the predicate
 * below names `cancelled` rather than "the last two".
 *
 * Custom statuses follow their own category, so a workspace that put a status
 * in `cancelled` drops it here exactly as web does.
 */
export function stepChainKeys(
  steps: readonly Pick<IssueWorkflowStep, "status_key">[],
  categoryOf: (statusKey: string) => string,
): string[] {
  return steps
    .filter((step) => step.status_key !== "blocked" && categoryOf(step.status_key) !== "cancelled")
    .map((step) => step.status_key);
}

/** What the management list draws, given the read's state and its rows. */
export type WorkflowListState = "loading" | "failed" | "empty" | "ready";

/**
 * The list page's four-way branch, as a pure decision.
 *
 * ## Why this is a function rather than an inline ternary
 *
 * The failure it prevents is specific and it already happened once in this app
 * for projects, agents and chat (`lib/catalog-state.ts`): a failed read
 * defaulting to `[]`, which then renders as 「此工作区还没有…」 — a claim about
 * the workspace made by a request that never answered. Here that claim is worse
 * than usual, because the empty sentence invites the reader to CREATE the
 * thing their workspace already has.
 *
 * Written inline as nested ternaries it is one careless edit away from
 * `` state === "failed" || rows.length === 0 `` — a change no reviewer would
 * notice and no string assertion can catch. As a function, the ordering
 * (failure BEFORE emptiness) is a test with four named outcomes.
 *
 * `ready` with zero rows is `empty`; `failed` is NEVER `empty`, even though
 * the hook hands back `workflows === undefined` in both cases.
 */
export function workflowListState(
  state: "pending" | "failed" | "ready",
  rowCount: number,
): WorkflowListState {
  if (state === "pending") return "loading";
  if (state === "failed") return "failed";
  return rowCount > 0 ? "ready" : "empty";
}
