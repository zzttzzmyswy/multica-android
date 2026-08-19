import { beforeEach, describe, expect, it } from "vitest";
import {
  useNewIssueDraftStore,
  type AgentActorValue,
} from "./new-issue-draft-store";
import type { Label } from "@multica/core/types";

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
    useNewIssueDraftStore.getState().reset();
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
});