import { beforeEach, describe, expect, it } from "vitest";
import { useNewIssueStagePickStore } from "./new-issue-stage-pick-store";

/**
 * The whole point of this store is the parent tag on the picked stage: a stage
 * orders an issue against ITS siblings, so a value chosen for one parent must
 * not be replayed onto another. These tests pin that isolation, which is
 * invisible in the UI (a leaked stage just looks like a pre-filled chip).
 */
describe("useNewIssueStagePickStore", () => {
  beforeEach(() => {
    useNewIssueStagePickStore.getState().reset();
  });

  it("reads back the stage chosen for the same parent", () => {
    const s = useNewIssueStagePickStore.getState();
    s.openFor("parent-a");
    s.setStage("parent-a", 3);
    expect(useNewIssueStagePickStore.getState().stageFor("parent-a")).toBe(3);
  });

  it("does NOT leak a stage chosen under a different parent", () => {
    const s = useNewIssueStagePickStore.getState();
    s.setStage("parent-a", 3);
    expect(useNewIssueStagePickStore.getState().stageFor("parent-b")).toBeNull();
  });

  it("reads null for a rootless issue even after a stage was picked", () => {
    const s = useNewIssueStagePickStore.getState();
    s.setStage("parent-a", 2);
    expect(useNewIssueStagePickStore.getState().stageFor(null)).toBeNull();
    expect(useNewIssueStagePickStore.getState().stageFor(undefined)).toBeNull();
  });

  it("round-trips an explicit “no stage” pick", () => {
    // Clearing the stage is a real choice, not an absence.
    const s = useNewIssueStagePickStore.getState();
    s.setStage("parent-a", 4);
    s.setStage("parent-a", null);
    expect(useNewIssueStagePickStore.getState().stageFor("parent-a")).toBeNull();
  });

  it("reset drops the pick so a spent form does not reseed the next one", () => {
    const s = useNewIssueStagePickStore.getState();
    s.openFor("parent-a");
    s.setStage("parent-a", 5);
    useNewIssueStagePickStore.getState().reset();
    expect(useNewIssueStagePickStore.getState().stageFor("parent-a")).toBeNull();
    expect(useNewIssueStagePickStore.getState().parentId).toBeNull();
  });
});
