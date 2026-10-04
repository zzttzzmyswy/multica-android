/**
 * Draft state for the New Issue modal (`app/(app)/[workspace]/new-issue.tsx`).
 *
 * Why a store instead of local useState: the formSheet picker routes
 * (`new-issue-picker/status.tsx`, etc.) live in a separate Stack screen and
 * have no React parent-child relationship with the new-issue modal. They
 * need a way to read the current draft value and write the new selection
 * back without prop-drilling through the router. A small Zustand store is
 * the minimum-viable cross-screen channel.
 *
 * Persistence — web parity (`packages/core/issues/stores/draft-store.ts`,
 * localStorage key `multica_issue_draft`). Web keeps the whole create-issue
 * draft: title, description, the agent prompt, every picked attribute, and
 * the active mode. Closing the dialog does NOT discard it; the draft is
 * restored on the next open, a dot on the sidebar's "New issue" row says one
 * is waiting, and only a successful submit consumes it. Mobile used to keep
 * the same values but in memory only, wiped on both mount and unmount — so
 * dismissing the form (or any app restart) silently threw the draft away
 * while web kept it. This store now persists per workspace through
 * `expo-file-system`, the same best-effort pattern as
 * `issue-create-settings-store.ts` / `comment-collapse-store.ts`.
 *
 * Scope, and why the shape is flat rather than `byWorkspace`: the rest of the
 * app reads `s.status` / `setStatus(next)` from this store without naming a
 * workspace (eight picker routes plus the attribute row). Keying the state by
 * workspace id would churn every one of those call sites for no behavioural
 * gain. Instead `useNewIssueDraftWorkspace(wsId)` binds the store to one
 * workspace's file and every setter writes through to it — the store is "the
 * active workspace's draft", exactly the role it already played, now with a
 * backing file.
 *
 * Web's stored description is markdown, so this store holds the same: the
 * screen serializes its mention input before writing. Restoring plain markdown
 * is lossless for submission and for further typing — the canonical
 * `[@name](mention://type/id)` links are already in the text, so
 * `serializeMentions` passes them through untouched.
 *
 * Workspace lifecycle: an `assignee` / `project` id only resolves in the
 * workspace whose lists seeded it, so a draft must never leak across
 * workspaces — `useNewIssueDraftWorkspace` re-binds on the id change and loads
 * the new workspace's own draft rather than showing the previous one's.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { Paths, File } from "expo-file-system";
import type {
  IssuePriority,
  IssueStatus,
  Label,
  Project,
} from "@multica/core/types";
import type { AssigneeValue } from "@/components/issue/pickers/assignee-picker-body";

/**
 * Actor picked in the agent-mode quick-create panel (`new-issue.tsx` →
 * `quick-create-panel.tsx`). Unlike `assignee` (member/agent/squad, manual
 * mode only), agent mode accepts exactly agent | squad — the thing that
 * will process the natural-language prompt.
 */
export type AgentActorValue = {
  type: "agent" | "squad";
  id: string;
} | null;

/** Which of the two create forms the draft is being edited in. Web keeps the
 *  equivalent as `draft.activeMode`. */
export type CreateMode = "manual" | "agent";

/** The persisted half of the draft — everything a reopen must restore, and
 *  nothing derived. Mirrors web's `IssueCreateDraft` minus the fields mobile
 *  has no equivalent for (property values, the upload pool). */
export interface NewIssueDraftValues {
  title: string;
  /** Markdown, as web stores it. The screen owns the mention-input instance
   *  and serializes into this field. */
  description: string;
  /** Agent-mode prompt. */
  prompt: string;
  mode: CreateMode;
  status: IssueStatus;
  priority: IssuePriority;
  assignee: AssigneeValue;
  dueDate: string | null;
  /** Calendar-day start date ("YYYY-MM-DD") — web `start_date` input.
   *  Picked from the same date-only spinner due_date uses. */
  startDate: string | null;
  /** Labels selected for the not-yet-created issue. Carried into the create
   *  payload as `label_ids` (server attaches in the same transaction).
   *  Multi-select, mirrors the issue-detail label picker. */
  labels: Label[];
  project: Project | null;
  agentActor: AgentActorValue;
}

interface NewIssueDraftState extends NewIssueDraftValues {
  /**
   * Whether the bound workspace's saved draft has been read yet. The form
   * must not treat the in-memory values as authoritative before this flips —
   * an empty store at mount is "not read yet", not "no draft", and writing
   * the empty state through would erase the file it is about to read.
   */
  hydrated: boolean;
  setTitle: (next: string) => void;
  setDescription: (next: string) => void;
  setPrompt: (next: string) => void;
  setMode: (next: CreateMode) => void;
  setStatus: (next: IssueStatus) => void;
  setPriority: (next: IssuePriority) => void;
  setAssignee: (next: AssigneeValue) => void;
  setDueDate: (next: string | null) => void;
  setStartDate: (next: string | null) => void;
  setLabels: (next: Label[]) => void;
  attachLabel: (label: Label) => void;
  detachLabel: (labelId: string) => void;
  setProject: (next: Project | null) => void;
  setAgentActor: (next: AgentActorValue) => void;
  /**
   * Seed the draft from a board column's implied defaults before opening the
   * modal (web `onCreateIssue(group.createData)` — board-column.tsx:226-246).
   * Only the fields the column actually determines are touched, so a column
   * with no defaults (the assignee grouping's "No assignee" lane) leaves the
   * draft alone. Callers reset the store first.
   */
  seedFromColumn: (defaults: {
    status?: IssueStatus;
    assignee?: AssigneeValue;
  }) => void;
  /** Drop the draft and clear its backing file. Web's `clearDraft`. */
  reset: () => void;
}

export const EMPTY_NEW_ISSUE_DRAFT: NewIssueDraftValues = {
  title: "",
  description: "",
  prompt: "",
  mode: "manual",
  status: "todo",
  priority: "none",
  assignee: null,
  dueDate: null,
  startDate: null,
  labels: [],
  project: null,
  agentActor: null,
};

/** Workspace the store is currently bound to, or null before the workspace
 *  layout has resolved one. Module-level rather than React state because the
 *  setters (called from picker routes with no workspace in scope) need it. */
let boundWorkspaceId: string | null = null;

/** Serialize file writes so a burst of keystrokes can't interleave. */
let persistChain: Promise<void> = Promise.resolve();

function draftFile(wsId: string): File {
  return new File(Paths.document, `multica-issue-draft-${wsId}.json`);
}

function persist(wsId: string, values: NewIssueDraftValues): void {
  persistChain = persistChain
    .then(() => {
      draftFile(wsId).write(JSON.stringify(values));
    })
    .catch(() => {
      // Best-effort: a failed write must never break typing.
    });
}

function writeThrough(values: NewIssueDraftValues): void {
  if (boundWorkspaceId) persist(boundWorkspaceId, values);
}

const asString = (raw: unknown): string =>
  typeof raw === "string" ? raw : "";

/** Closed set — an unlisted value would reach `PriorityIcon` with no mapping. */
const ISSUE_PRIORITIES: readonly IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
];

const asNullableString = (raw: unknown): string | null =>
  typeof raw === "string" ? raw : null;

/**
 * Rebuild a draft from an untrusted persisted blob. Every field is coerced
 * back to its own type and out-of-range enums fall back to the empty
 * default, so a file left by an older build (or hand-edited) can never put
 * the form into a state its own controls cannot render.
 */
export function normalizeNewIssueDraft(raw: unknown): NewIssueDraftValues {
  if (!raw || typeof raw !== "object") return { ...EMPTY_NEW_ISSUE_DRAFT };
  const d = raw as Record<string, unknown>;
  return {
    title: asString(d.title),
    description: asString(d.description),
    prompt: asString(d.prompt),
    // A mode the app no longer knows is indistinguishable from "not set".
    mode: d.mode === "agent" ? "agent" : "manual",
    // Statuses are workspace-defined (`IssueStatus = IssueStatusCategory |
    // (string & {})`), so any non-empty string is renderable; priority is a
    // closed set, so anything else must fall back rather than reach the icon.
    status: asString(d.status) || EMPTY_NEW_ISSUE_DRAFT.status,
    priority: ISSUE_PRIORITIES.includes(d.priority as IssuePriority)
      ? (d.priority as IssuePriority)
      : EMPTY_NEW_ISSUE_DRAFT.priority,
    assignee:
      d.assignee && typeof d.assignee === "object"
        ? (d.assignee as AssigneeValue)
        : null,
    dueDate: asNullableString(d.dueDate),
    startDate: asNullableString(d.startDate),
    labels: Array.isArray(d.labels) ? (d.labels as Label[]) : [],
    project:
      d.project && typeof d.project === "object" ? (d.project as Project) : null,
    agentActor:
      d.agentActor && typeof d.agentActor === "object"
        ? (d.agentActor as AgentActorValue)
        : null,
  };
}

/**
 * Web's `hasDraft` rule, adapted: web inspects only the content fields
 * (title / description / prompt / property values / uploads) because its
 * attribute selections are not part of what it considers recoverable. On
 * mobile every attribute in this store IS persisted and IS restored, so
 * leaving them out would light no dot for a draft that genuinely comes back.
 * Either way the dot means the same thing: reopening the form returns work
 * the user already did.
 */
export function draftHasContent(values: NewIssueDraftValues): boolean {
  return Boolean(
    values.title.trim() ||
      values.description.trim() ||
      values.prompt.trim() ||
      values.status !== EMPTY_NEW_ISSUE_DRAFT.status ||
      values.priority !== EMPTY_NEW_ISSUE_DRAFT.priority ||
      values.assignee ||
      values.dueDate ||
      values.startDate ||
      values.labels.length > 0 ||
      values.project ||
      values.agentActor,
  );
}

export const useNewIssueDraftStore = create<NewIssueDraftState>((set, get) => {
  /** Merge a patch, write the result through, and return the new state. */
  const commit = (patch: Partial<NewIssueDraftValues>) => {
    const next = { ...snapshot(get()), ...patch };
    writeThrough(next);
    set(patch);
  };

  return {
    ...EMPTY_NEW_ISSUE_DRAFT,
    hydrated: false,
    setTitle: (next) => commit({ title: next }),
    setDescription: (next) => commit({ description: next }),
    setPrompt: (next) => commit({ prompt: next }),
    setMode: (next) => commit({ mode: next }),
    setStatus: (next) => commit({ status: next }),
    setPriority: (next) => commit({ priority: next }),
    setAssignee: (next) => commit({ assignee: next }),
    setDueDate: (next) => commit({ dueDate: next }),
    setStartDate: (next) => commit({ startDate: next }),
    setLabels: (next) => commit({ labels: next }),
    attachLabel: (label) => {
      const { labels } = get();
      if (labels.some((l) => l.id === label.id)) return;
      commit({ labels: [...labels, label] });
    },
    detachLabel: (labelId) => {
      const { labels } = get();
      if (!labels.some((l) => l.id === labelId)) return;
      commit({ labels: labels.filter((l) => l.id !== labelId) });
    },
    setProject: (next) => commit({ project: next }),
    setAgentActor: (next) => commit({ agentActor: next }),
    seedFromColumn: ({ status, assignee }) =>
      commit({
        ...(status !== undefined ? { status } : {}),
        // `assignee` is nullable on purpose: an assignee lane passes a
        // `{type, id}` pair, while a column with no implied assignee passes
        // `undefined` and must NOT clear a previously picked one.
        ...(assignee !== undefined ? { assignee } : {}),
      }),
    reset: () => {
      // Persist the empty draft rather than deleting the file: the write is
      // ordered on the same chain as every other write, so a delete could
      // race a queued persist and resurrect the draft.
      writeThrough(EMPTY_NEW_ISSUE_DRAFT);
      set({ ...EMPTY_NEW_ISSUE_DRAFT });
    },
  };
});
export function snapshot(state: NewIssueDraftValues): NewIssueDraftValues {
  return {
    title: state.title,
    description: state.description,
    prompt: state.prompt,
    mode: state.mode,
    status: state.status,
    priority: state.priority,
    assignee: state.assignee,
    dueDate: state.dueDate,
    startDate: state.startDate,
    labels: state.labels,
    project: state.project,
    agentActor: state.agentActor,
  };
}

/**
 * Bind the draft store to one workspace, loading that workspace's saved
 * draft. Re-running for the same workspace is a no-op; a different workspace
 * loads ITS draft (never the previous one's values). Mounted once from the
 * workspace `_layout.tsx`.
 *
 * `hydrated` stays false until the read resolves. Consumers that must not act
 * on the pre-read state (the create form restoring its body, the mirror that
 * writes edits back) wait for it — otherwise "not read yet" is
 * indistinguishable from "no draft", and the empty in-memory state would
 * overwrite the file it is about to read.
 */
export function useNewIssueDraftWorkspace(wsId: string | null) {
  const prevRef = useRef<string | null>(null);
  useEffect(() => {
    if (!wsId || prevRef.current === wsId) return;
    // Clear synchronously FIRST. Switching workspaces must never leave the
    // previous workspace's draft on screen — not even for the frames the file
    // read takes. This is an in-memory clear (`setState`, not `commit`), so it
    // writes nothing: the workspace we just left keeps its saved draft, and
    // the one we are entering has not been touched yet.
    boundWorkspaceId = wsId;
    useNewIssueDraftStore.setState({ ...EMPTY_NEW_ISSUE_DRAFT, hydrated: false });
    prevRef.current = wsId;
    let cancelled = false;
    void (async () => {
      let raw: unknown = null;
      try {
        const file = draftFile(wsId);
        if (file.exists) raw = JSON.parse(await file.text()) as unknown;
      } catch {
        // A corrupt draft is not worth crashing over — start clean.
        raw = null;
      }
      // A late read must never clobber work started meanwhile. `commit` only
      // writes through once bound, so anything typed during the read is both
      // in memory and on disk; the file we just read is the older of the two.
      if (cancelled) return;
      const current = useNewIssueDraftStore.getState();
      if (draftHasContent(snapshot(current))) {
        useNewIssueDraftStore.setState({ hydrated: true });
        return;
      }
      useNewIssueDraftStore.setState({
        ...normalizeNewIssueDraft(raw),
        hydrated: true,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [wsId]);
}

/** Test-only: bind a workspace without a React effect, mirroring what
 *  `useNewIssueDraftWorkspace` does on the workspace-id transition. */
export function __bindNewIssueDraftWorkspace(wsId: string | null) {
  boundWorkspaceId = wsId;
}

/** Test-only: await the queued writes so assertions can read the file. */
export function __flushNewIssueDraftWrites(): Promise<void> {
  return persistChain;
}

/** Test-only: forget the bound workspace and any queued writes. */
export function __resetNewIssueDraftBinding() {
  boundWorkspaceId = null;
  persistChain = Promise.resolve();
}
