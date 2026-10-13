import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(() => [{ languageCode: "zh" }]),
}));

import { REVISION_CONFLICT_CODE } from "@multica/core/issues/revision-conflict";
import {
  REVISION_CONFLICT_KEY,
  isDuplicateMarkConflictError,
  isRevisionConflictError,
  revisionConflictActions,
  revisionForEdit,
} from "./revision-conflict";

/** A 409 exactly as `mu.zztweb.top` sends it (probed 2026-10-13). */
function conflict(body: Record<string, unknown> = {}) {
  return {
    status: 409,
    body: { code: REVISION_CONFLICT_CODE, resource_type: "comment", ...body },
  };
}

describe("revisionForEdit", () => {
  it("passes through a revision the server could have sent", () => {
    expect(revisionForEdit(1)).toBe(1);
    expect(revisionForEdit(10)).toBe(10);
  });

  it("returns undefined for an absent revision, so the write stays ungated", () => {
    // A server that predates the field sends nothing. Gating on a synthesised
    // 0 would be a 400 ("expected_revision must be a positive integer") on an
    // edit that used to work, so "cannot gate" has to be expressible.
    expect(revisionForEdit(undefined)).toBeUndefined();
    expect(revisionForEdit(null)).toBeUndefined();
  });

  it("refuses to send a value the server would reject as malformed", () => {
    expect(revisionForEdit(0)).toBeUndefined();
    expect(revisionForEdit(-1)).toBeUndefined();
    expect(revisionForEdit(1.5)).toBeUndefined();
    expect(revisionForEdit(Number.NaN)).toBeUndefined();
    expect(revisionForEdit(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(revisionForEdit("7")).toBeUndefined();
  });
});

describe("isRevisionConflictError", () => {
  it("recognises both shapes the live server sends", () => {
    // The aggregate token and the field baseline are different bodies with the
    // same meaning for the reader.
    expect(isRevisionConflictError(conflict())).toBe(true);
    expect(
      isRevisionConflictError({ status: 409, body: { code: REVISION_CONFLICT_CODE } }),
    ).toBe(true);
  });

  it("does not claim the other 409s on the same endpoints", () => {
    // Same status, unrelated situation. Telling this member to "refresh and
    // compare versions" names a race that never happened.
    expect(
      isRevisionConflictError({ status: 409, body: { code: "duplicate_target_is_duplicate" } }),
    ).toBe(false);
    expect(
      isRevisionConflictError({
        status: 409,
        body: { error: "the target status was archived while this request was in flight" },
      }),
    ).toBe(false);
  });

  it("survives a transport failure", () => {
    expect(isRevisionConflictError(new Error("Network request failed"))).toBe(false);
    expect(isRevisionConflictError(undefined)).toBe(false);
    expect(isRevisionConflictError(null)).toBe(false);
  });
});

describe("isDuplicateMarkConflictError", () => {
  it("separates the duplicate refusals from a lost update", () => {
    expect(
      isDuplicateMarkConflictError({
        status: 409,
        body: { code: "duplicate_target_is_duplicate" },
      }),
    ).toBe(true);
    expect(isDuplicateMarkConflictError(conflict())).toBe(false);
  });
});

describe("the recovery choices mirror web's", () => {
  it("offers adopting the server version first, and marks the overwrite", () => {
    const actions = revisionConflictActions();
    expect(actions.map((a) => a.choice)).toEqual(["useServer", "keepLocal"]);
    // "Keep my version" overwrites another writer's saved edit — destructive.
    // "Use the latest version" cannot lose anyone's work, so it is not.
    expect(actions[0]?.destructive).toBe(false);
    expect(actions[1]?.destructive).toBe(true);
  });

  it("uses web's own i18n ids, so the two clients read the same", () => {
    // packages/views/locales/{en,zh-Hans}/issues.json `revision.*`.
    expect(revisionConflictActions().map((a) => a.labelKey)).toEqual([
      "revision.useServer",
      "revision.keepLocal",
    ]);
  });

  it("classifies a lost update under web's own key", () => {
    expect(REVISION_CONFLICT_KEY).toBe("revision.conflict");
  });
});
