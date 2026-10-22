import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Native-module mocks (Node vitest lane) ────────────────────────────────
// Same in-memory File shim the comment-collapse / workbench-layout suites
// use: the module is mocked, so the app's real expo-file-system native module
// never loads.
vi.mock("expo-file-system", () => {
  const store = new Map<string, string>();
  return {
    __fsStore: store,
    File: class MockFile {
      uri: string;
      exists: boolean;
      constructor(...uris: Array<{ uri?: string } | string>) {
        this.uri = uris
          .map((u) =>
            typeof u === "string" ? u : (u as { uri?: string }).uri ?? "",
          )
          .join("/");
        this.exists = store.has(this.uri);
      }
      text(): Promise<string> {
        return Promise.resolve(store.get(this.uri) ?? "");
      }
      write(content: string): void {
        store.set(this.uri, content);
      }
      delete(): void {
        store.delete(this.uri);
        this.exists = false;
      }
    },
    Paths: { document: { uri: "file:///doc" } },
  };
});

import * as fs from "expo-file-system";
import {
  useNewIssueDraftStore,
  draftHasContent,
  draftHasRecoverableIntent,
  normalizeNewIssueDraft,
  EMPTY_NEW_ISSUE_DRAFT,
  __bindNewIssueDraftWorkspace,
  __flushNewIssueDraftWrites,
  __resetNewIssueDraftBinding,
  type AgentActorValue,
} from "./new-issue-draft-store";
import type { Label } from "@multica/core/types";

const fsStore = (fs as unknown as { __fsStore: Map<string, string> }).__fsStore;
const fileFor = (wsId: string) => `file:///doc/multica-issue-draft-${wsId}.json`;

/** The persisted blob for a workspace, parsed. */
function savedDraft(wsId: string): Record<string, unknown> | null {
  const raw = fsStore.get(fileFor(wsId));
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

const LABEL_A: Label = {
  id: "la-1",
  workspace_id: "ws-1",
  name: "bug",
  color: "#ef4444",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};
const LABEL_B: Label = {
  id: "la-2",
  workspace_id: "ws-1",
  name: "feature",
  color: "#22c55e",
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

describe("new-issue-draft-store", () => {
  beforeEach(() => {
    fsStore.clear();
    __resetNewIssueDraftBinding();
    __bindNewIssueDraftWorkspace("ws-1");
    useNewIssueDraftStore.setState({
      ...EMPTY_NEW_ISSUE_DRAFT,
      batchContinuationBaseline: null,
    });
  });

  it("seeds empty draft defaults including labels and startDate", () => {
    const s = useNewIssueDraftStore.getState();
    expect(s.status).toBe("todo");
    expect(s.priority).toBe("none");
    expect(s.assignee).toBeNull();
    expect(s.dueDate).toBeNull();
    expect(s.project).toBeNull();
    expect(s.agentActor).toBeNull();
    expect(s.labels).toEqual([]);
    expect(s.startDate).toBeNull();
  });

  it("setLabels replaces the whole label set", () => {
    useNewIssueDraftStore.getState().setLabels([LABEL_A, LABEL_B]);
    expect(useNewIssueDraftStore.getState().labels).toEqual([LABEL_A, LABEL_B]);
  });

  it("attachLabel appends and keeps selection unique", () => {
    useNewIssueDraftStore.getState().attachLabel(LABEL_A);
    useNewIssueDraftStore.getState().attachLabel(LABEL_B);
    // Duplicate attach is a no-op (idempotent — mirrors picker toggle guard).
    useNewIssueDraftStore.getState().attachLabel(LABEL_A);
    expect(useNewIssueDraftStore.getState().labels).toEqual([LABEL_A, LABEL_B]);
  });

  it("detachLabel removes by id and is a no-op when absent", () => {
    useNewIssueDraftStore.getState().attachLabel(LABEL_A);
    useNewIssueDraftStore.getState().attachLabel(LABEL_B);
    useNewIssueDraftStore.getState().detachLabel(LABEL_A.id);
    expect(useNewIssueDraftStore.getState().labels).toEqual([LABEL_B]);
    useNewIssueDraftStore.getState().detachLabel("missing");
    expect(useNewIssueDraftStore.getState().labels).toEqual([LABEL_B]);
  });

  it("setStartDate stores / clears the date-only string", () => {
    useNewIssueDraftStore.getState().setStartDate("2026-09-01");
    expect(useNewIssueDraftStore.getState().startDate).toBe("2026-09-01");
    useNewIssueDraftStore.getState().setStartDate(null);
    expect(useNewIssueDraftStore.getState().startDate).toBeNull();
  });

  it("reset clears labels and startDate alongside the classic draft fields", () => {
    useNewIssueDraftStore.getState().attachLabel(LABEL_A);
    useNewIssueDraftStore.getState().setStartDate("2026-09-01");
    useNewIssueDraftStore.getState().setDueDate("2026-09-30");
    useNewIssueDraftStore.getState().setAgentActor({
      type: "agent",
      id: "ag-1",
    } satisfies AgentActorValue);
    useNewIssueDraftStore.getState().reset();
    const s = useNewIssueDraftStore.getState();
    expect(s.labels).toEqual([]);
    expect(s.startDate).toBeNull();
    expect(s.dueDate).toBeNull();
    expect(s.agentActor).toBeNull();
  });

  // ── Persistence (web parity: `multica_issue_draft`) ─────────────────────

  it("writes each edit through to the bound workspace's file", async () => {
    useNewIssueDraftStore.getState().setTitle("Half-typed title");
    useNewIssueDraftStore.getState().setDueDate("2026-09-30");
    await __flushNewIssueDraftWrites();

    const saved = savedDraft("ws-1");
    expect(saved?.title).toBe("Half-typed title");
    expect(saved?.dueDate).toBe("2026-09-30");
    // The blob is the flat draft shape the loader reads back, not a wrapper.
    expect(Object.keys(saved ?? {}).sort()).toEqual(
      [
        "agentActor",
        "assignee",
        "description",
        "dueDate",
        "labels",
        "mode",
        "priority",
        "project",
        "prompt",
        // Added in iteration 259 (MYS-2245): a create form's custom-property
        // choices ride the draft, so they must survive a reopen like every
        // other attribute.
        "propertyValues",
        "startDate",
        "status",
        "title",
      ].sort(),
    );
  });

  it("writes an empty draft for reset instead of deleting the file", async () => {
    useNewIssueDraftStore.getState().setTitle("spent");
    await __flushNewIssueDraftWrites();
    useNewIssueDraftStore.getState().reset();
    await __flushNewIssueDraftWrites();

    // Delete would race a queued write and could resurrect the draft; an
    // empty blob ordered on the same chain cannot.
    expect(savedDraft("ws-1")?.title).toBe("");
    expect(draftHasContent(useNewIssueDraftStore.getState())).toBe(false);
  });

  it("keeps each workspace's draft in its own file", async () => {
    useNewIssueDraftStore.getState().setTitle("ws-1 draft");
    await __flushNewIssueDraftWrites();

    __bindNewIssueDraftWorkspace("ws-2");
    useNewIssueDraftStore.getState().setTitle("ws-2 draft");
    await __flushNewIssueDraftWrites();

    expect(savedDraft("ws-1")?.title).toBe("ws-1 draft");
    expect(savedDraft("ws-2")?.title).toBe("ws-2 draft");
  });

  it("writes nothing before a workspace is bound", async () => {
    __bindNewIssueDraftWorkspace(null);
    useNewIssueDraftStore.getState().setTitle("orphan");
    await __flushNewIssueDraftWrites();

    // No workspace yet (cold start, pre-layout) — there is no file to own it.
    expect(fsStore.size).toBe(0);
    // The value still lands in memory, so nothing the user typed is lost.
    expect(useNewIssueDraftStore.getState().title).toBe("orphan");
  });

  // ── "Create another" batch continuation (MUL-7648) ──────────────────────
  //
  // Web keeps the submitted status and the parent/stage across the next issue
  // of a batch. Keeping the status creates a second problem: an untouched
  // continuation looks exactly like a draft the user is working on, so it needs
  // a baseline to be told apart.

  describe("batch continuation", () => {
    it("keeps BOTH the assignee and the submitted status", () => {
      useNewIssueDraftStore.getState().setAssignee({ type: "member", id: "m-1" });
      useNewIssueDraftStore.getState().setStatus("in_progress");
      useNewIssueDraftStore.getState().setTitle("first");
      useNewIssueDraftStore.getState().resetForNextIssue();

      const s = useNewIssueDraftStore.getState();
      expect(s.assignee).toEqual({ type: "member", id: "m-1" });
      // MUL-7648: the status is no longer reset to todo.
      expect(s.status).toBe("in_progress");
    });

    it("clears the content of the issue just filed", () => {
      useNewIssueDraftStore.getState().setTitle("first");
      useNewIssueDraftStore.getState().setDescription("body");
      useNewIssueDraftStore.getState().setPriority("urgent");
      useNewIssueDraftStore.getState().setDueDate("2026-11-01");
      useNewIssueDraftStore.getState().setStartDate("2026-11-01");
      useNewIssueDraftStore.getState().attachLabel(LABEL_A);
      useNewIssueDraftStore.getState().resetForNextIssue();

      const s = useNewIssueDraftStore.getState();
      expect(s.title).toBe("");
      expect(s.description).toBe("");
      expect(s.priority).toBe("none");
      expect(s.dueDate).toBeNull();
      expect(s.startDate).toBeNull();
      expect(s.labels).toEqual([]);
    });

    it("records the reset draft as the continuation baseline", () => {
      useNewIssueDraftStore.getState().setStatus("in_progress");
      useNewIssueDraftStore.getState().resetForNextIssue();

      const s = useNewIssueDraftStore.getState();
      expect(s.batchContinuationBaseline).not.toBeNull();
      // The baseline describes the draft the reset produced, not the submitted
      // issue — otherwise every continuation would read as "already edited".
      expect(s.batchContinuationBaseline?.title).toBe("");
      expect(s.batchContinuationBaseline?.status).toBe("in_progress");
    });

    it("an untouched continuation does NOT light the draft dot", () => {
      useNewIssueDraftStore.getState().setStatus("in_progress");
      useNewIssueDraftStore.getState().resetForNextIssue();

      // Inherited status + assignee only: nothing here is the user's work.
      expect(draftHasRecoverableIntent(useNewIssueDraftStore.getState())).toBe(false);
      // The plain content rule WOULD have lit it — which is the bug the
      // baseline exists to prevent.
      expect(draftHasContent(useNewIssueDraftStore.getState())).toBe(true);
    });

    it("an edited continuation DOES light the draft dot", () => {
      useNewIssueDraftStore.getState().resetForNextIssue();
      useNewIssueDraftStore.getState().setPriority("high");
      expect(draftHasRecoverableIntent(useNewIssueDraftStore.getState())).toBe(true);
    });

    it("persists an untouched continuation at the create default status", async () => {
      useNewIssueDraftStore.getState().setStatus("in_progress");
      useNewIssueDraftStore.getState().setTitle("first");
      useNewIssueDraftStore.getState().resetForNextIssue();
      await __flushNewIssueDraftWrites();

      // On disk: todo, so a reload cannot present the inherited status as a
      // choice. In memory: still in_progress, because the live form is still
      // inside the batch and its chip must show what the next issue inherits.
      expect(savedDraft("ws-1")?.status).toBe("todo");
      expect(useNewIssueDraftStore.getState().status).toBe("in_progress");
    });

    it("persists an EDITED continuation's status as-is", async () => {
      useNewIssueDraftStore.getState().setStatus("in_progress");
      useNewIssueDraftStore.getState().resetForNextIssue();
      useNewIssueDraftStore.getState().setTitle("second issue");
      await __flushNewIssueDraftWrites();

      expect(savedDraft("ws-1")?.status).toBe("in_progress");
    });

    it("endBatchContinuation drops an untouched continuation's status", () => {
      useNewIssueDraftStore.getState().setStatus("in_progress");
      useNewIssueDraftStore.getState().resetForNextIssue();
      useNewIssueDraftStore.getState().endBatchContinuation();

      const s = useNewIssueDraftStore.getState();
      expect(s.status).toBe("todo");
      // The baseline is spent — holding it would make the NEXT batch compare
      // against the wrong draft.
      expect(s.batchContinuationBaseline).toBeNull();
    });

    it("endBatchContinuation keeps an edited continuation intact", () => {
      useNewIssueDraftStore.getState().setStatus("in_progress");
      useNewIssueDraftStore.getState().resetForNextIssue();
      useNewIssueDraftStore.getState().setTitle("half-typed second issue");
      useNewIssueDraftStore.getState().endBatchContinuation();

      const s = useNewIssueDraftStore.getState();
      expect(s.title).toBe("half-typed second issue");
      expect(s.status).toBe("in_progress");
      expect(s.batchContinuationBaseline).toBeNull();
    });

    it("endBatchContinuation is a no-op when no continuation is live", () => {
      useNewIssueDraftStore.getState().setTitle("ordinary draft");
      useNewIssueDraftStore.getState().setStatus("done");
      useNewIssueDraftStore.getState().endBatchContinuation();

      // An ordinary draft must not have its status rewritten out from under
      // it: the normalization only ever applies to a batch.
      expect(useNewIssueDraftStore.getState().status).toBe("done");
      expect(useNewIssueDraftStore.getState().title).toBe("ordinary draft");
    });

    it("reset() ends the batch as well", () => {
      useNewIssueDraftStore.getState().resetForNextIssue();
      expect(useNewIssueDraftStore.getState().batchContinuationBaseline).not.toBeNull();
      useNewIssueDraftStore.getState().reset();
      expect(useNewIssueDraftStore.getState().batchContinuationBaseline).toBeNull();
      expect(useNewIssueDraftStore.getState().status).toBe("todo");
    });

    it("a fresh continuation re-baselines against the new draft", () => {
      // Two submits in one batch: the second must compare against what the
      // SECOND reset produced, not the first — otherwise the first batch's
      // edits would make every later continuation look edited.
      useNewIssueDraftStore.getState().setStatus("in_progress");
      useNewIssueDraftStore.getState().resetForNextIssue();
      useNewIssueDraftStore.getState().setTitle("second");
      useNewIssueDraftStore.getState().resetForNextIssue();

      expect(draftHasRecoverableIntent(useNewIssueDraftStore.getState())).toBe(false);
    });
  });

  // ── draftHasContent: the entry-point dot's rule ────────────────────────

  it("draftHasContent is false for an empty draft and true once anything lands", () => {
    expect(draftHasContent(EMPTY_NEW_ISSUE_DRAFT)).toBe(false);
    // Whitespace alone is not a draft.
    expect(draftHasContent({ ...EMPTY_NEW_ISSUE_DRAFT, title: "   " })).toBe(false);

    for (const patch of [
      { title: "t" },
      { description: "d" },
      { prompt: "p" },
      { status: "in_progress" as const },
      { priority: "high" as const },
      { assignee: { type: "member" as const, id: "m-1" } },
      { dueDate: "2026-09-30" },
      { startDate: "2026-09-01" },
      { labels: [LABEL_A] },
      { project: { id: "pr-1" } as never },
      { agentActor: { type: "agent" as const, id: "ag-1" } },
    ]) {
      expect(draftHasContent({ ...EMPTY_NEW_ISSUE_DRAFT, ...patch })).toBe(true);
    }
  });

  // ── normalizeNewIssueDraft: untrusted blobs must not break the form ─────

  it("normalizes a corrupt blob back to a renderable draft", () => {
    expect(normalizeNewIssueDraft(null)).toEqual(EMPTY_NEW_ISSUE_DRAFT);
    expect(normalizeNewIssueDraft("nonsense")).toEqual(EMPTY_NEW_ISSUE_DRAFT);

    // Wrong-typed fields fall back per field rather than failing the load.
    const partial = normalizeNewIssueDraft({
      title: 42,
      description: null,
      mode: "telepathy",
      status: "",
      priority: "none",
      assignee: "not-an-object",
      labels: "not-an-array",
      project: 7,
      dueDate: 5,
    });
    expect(partial.title).toBe("");
    expect(partial.description).toBe("");
    expect(partial.mode).toBe("manual");
    expect(partial.status).toBe("todo");
    expect(partial.priority).toBe("none");
    expect(partial.assignee).toBeNull();
    // A priority outside the closed set is dropped rather than handed to
    // PriorityIcon, which has no mapping for it.
    expect(normalizeNewIssueDraft({ priority: "catastrophic" }).priority).toBe(
      "none",
    );
    // A custom status is a legitimate string (statuses are workspace-defined).
    expect(normalizeNewIssueDraft({ status: "in_review" }).status).toBe(
      "in_review",
    );
    expect(partial.labels).toEqual([]);
    expect(partial.project).toBeNull();
    expect(partial.dueDate).toBeNull();

    // Real values survive a round trip.
    const kept = normalizeNewIssueDraft({
      title: "kept",
      mode: "agent",
      assignee: { type: "agent", id: "ag-9" },
      labels: [LABEL_A],
      startDate: "2026-09-01",
    });
    expect(kept.title).toBe("kept");
    expect(kept.mode).toBe("agent");
    expect(kept.assignee).toEqual({ type: "agent", id: "ag-9" });
    expect(kept.labels).toEqual([LABEL_A]);
    expect(kept.startDate).toBe("2026-09-01");
  });
});