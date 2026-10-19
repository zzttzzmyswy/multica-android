/**
 * Iteration 258 (MYS-2236) — the two runtime deletes are two DIFFERENT deletes.
 *
 * The defect these tests pin: the machine-detail row menu and the runtime
 * detail page both offered a correctly-labelled "Delete from workspace" entry
 * for a custom runtime and both called `useDeleteRuntimeFlow` — the endpoint
 * that removes the RUNTIME INSTANCE from the machine. The profile
 * registration, which is what the label names and the only thing every other
 * machine's identical row depends on, was never touched. The confirmation
 * copy described one object; the request destroyed another.
 *
 * Every assertion below is about which object a given input names, because
 * that is the decision the bug got wrong — not the wording, not the endpoint
 * URL (both were already right).
 */
import { describe, expect, it, vi } from "vitest";
import {
  classifyProfileDeleteFailure,
  dispatchRuntimeDelete,
  runtimeDeleteTarget,
} from "./runtime-profile-delete";

describe("runtimeDeleteTarget names the object the row's delete removes", () => {
  it("names the PROFILE of a custom runtime, even though the row has an id too", () => {
    // The whole bug in one assertion: both ids are present, and picking the
    // runtime id is what shipped for months.
    expect(
      runtimeDeleteTarget({ id: "rt-1", profile_id: "prof-1" }),
    ).toEqual({ kind: "profile", profileId: "prof-1" });
  });

  it("names the RUNTIME when the row has no profile", () => {
    expect(runtimeDeleteTarget({ id: "rt-1", profile_id: null })).toEqual({
      kind: "runtime",
      runtimeId: "rt-1",
    });
  });

  it("treats an empty profile_id as built-in (older backends omit the field)", () => {
    // `""` is what a zero-value field serializes to; reading it as truthy
    // would route a built-in runtime to the profile endpoint with an empty id.
    expect(runtimeDeleteTarget({ id: "rt-1", profile_id: "" })).toEqual({
      kind: "runtime",
      runtimeId: "rt-1",
    });
    expect(runtimeDeleteTarget({ id: "rt-1" })).toEqual({
      kind: "runtime",
      runtimeId: "rt-1",
    });
  });

  it("names nothing while the runtime has not loaded", () => {
    expect(runtimeDeleteTarget(null)).toBeNull();
    expect(runtimeDeleteTarget(undefined)).toBeNull();
  });

  it("names nothing for a profile row with no id of either kind", () => {
    expect(runtimeDeleteTarget({ id: "", profile_id: null })).toBeNull();
    expect(runtimeDeleteTarget({ id: null, profile_id: "" })).toBeNull();
  });
});

describe("dispatchRuntimeDelete hits two different endpoints", () => {
  it("a profile target calls ONLY deleteProfile", () => {
    const deleteProfile = vi.fn();
    const deleteRuntime = vi.fn();
    dispatchRuntimeDelete(
      { kind: "profile", profileId: "prof-1" },
      { deleteProfile, deleteRuntime },
    );
    expect(deleteProfile).toHaveBeenCalledExactlyOnceWith("prof-1");
    // The destructive half of the defect: a profile delete that also tears
    // down the instance is not a fixed version of the bug, it is a worse one.
    expect(deleteRuntime).not.toHaveBeenCalled();
  });

  it("a runtime target calls ONLY deleteRuntime", () => {
    const deleteProfile = vi.fn();
    const deleteRuntime = vi.fn();
    dispatchRuntimeDelete(
      { kind: "runtime", runtimeId: "rt-1" },
      { deleteProfile, deleteRuntime },
    );
    expect(deleteRuntime).toHaveBeenCalledExactlyOnceWith("rt-1");
    expect(deleteProfile).not.toHaveBeenCalled();
  });

  it("carries the id the target names, not the other one", () => {
    // A caller that mixed the ids up would still typecheck if the target used
    // one shared `id` field; this is why the two fields are named apart.
    const deleteProfile = vi.fn();
    dispatchRuntimeDelete(
      runtimeDeleteTarget({ id: "rt-9", profile_id: "prof-7" })!,
      { deleteProfile, deleteRuntime: vi.fn() },
    );
    expect(deleteProfile).toHaveBeenCalledWith("prof-7");
    expect(deleteProfile).not.toHaveBeenCalledWith("rt-9");
  });
});

describe("classifyProfileDeleteFailure keeps the dialog open on a bound refusal", () => {
  const boundParser = (err: unknown) =>
    err === "bound" ? { message: "2 agents still use this runtime" } : null;

  it("a 409 keeps the dialog open and prints the SERVER's reason", () => {
    const failure = classifyProfileDeleteFailure(
      "bound",
      boundParser,
      "fallback",
    );
    expect(failure.keepsDialogOpen).toBe(true);
    expect(failure.fromServer).toBe(true);
    expect(failure.message).toBe("2 agents still use this runtime");
  });

  it("a 409 with an empty server message falls back to the localized copy but still stays open", () => {
    // "The server said no and did not say why" is still a refusal the reader
    // must see; closing the dialog would leave them with a toast and nothing
    // to act on.
    const failure = classifyProfileDeleteFailure(
      "bound",
      () => ({ message: "   " }),
      "This runtime can't be deleted while agents are still using it.",
    );
    expect(failure.keepsDialogOpen).toBe(true);
    expect(failure.fromServer).toBe(false);
    expect(failure.message).toBe(
      "This runtime can't be deleted while agents are still using it.",
    );
  });

  it("an ordinary failure is NOT a bound refusal — the dialog may close", () => {
    const failure = classifyProfileDeleteFailure(
      new Error("network down"),
      boundParser,
      "fallback",
    );
    expect(failure.keepsDialogOpen).toBe(false);
    expect(failure.message).toBe("network down");
  });

  it("an Error with no message falls back rather than printing an empty line", () => {
    const failure = classifyProfileDeleteFailure(
      new Error("   "),
      boundParser,
      "Failed to delete the runtime.",
    );
    expect(failure.keepsDialogOpen).toBe(false);
    expect(failure.message).toBe("Failed to delete the runtime.");
  });
});
