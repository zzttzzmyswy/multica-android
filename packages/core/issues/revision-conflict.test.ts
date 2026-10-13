import { describe, expect, it } from "vitest";

import {
  REVISION_CONFLICT_CODE,
  errorCodeOf,
  isDuplicateMarkConflict,
  isRevisionConflict,
  parseRevisionConflict,
} from "./revision-conflict";

/**
 * The two bodies below are COPIES of what `mu.zztweb.top` actually answered to
 * a refused write (probed 2026-10-13 against MYS-2123, whose issue revision was
 * 10 and whose comment revision was 1). They are the fixtures the whole rule is
 * written against, so they are reproduced verbatim rather than paraphrased.
 */
const AGGREGATE_CONFLICT = {
  status: 409,
  body: {
    code: "revision_conflict",
    resource_type: "comment",
    resource_id: "01a1330f-cb3e-7895-8ef5-2275b156fe78",
    expected_revision: 999999,
    actual_revision: 1,
    error: "resource changed since it was loaded",
  },
};

const FIELD_CONFLICT = {
  status: 409,
  body: {
    code: "revision_conflict",
    resource_type: "issue",
    resource_id: "01a132b4-cafc-7d94-810d-0f3299fbcf3c",
    error: "resource field changed since it was loaded",
  },
};

/** The other 409s the SAME endpoints emit — each one must stay out. */
const STATUS_ARCHIVE_RACE = {
  status: 409,
  body: {
    error:
      "the target status was archived while this request was in flight; reload the status list and retry",
  },
};

const DUPLICATE_TARGET = {
  status: 409,
  body: {
    code: "duplicate_target_is_duplicate",
    error: "the target issue is itself a duplicate",
  },
};

describe("isRevisionConflict", () => {
  it("recognises the aggregate-token refusal", () => {
    expect(isRevisionConflict(AGGREGATE_CONFLICT)).toBe(true);
  });

  it("recognises the field-baseline refusal, which carries no revisions", () => {
    expect(isRevisionConflict(FIELD_CONFLICT)).toBe(true);
  });

  it("reads the code off the body without needing this package's ApiError", () => {
    // The mobile transport throws its OWN ApiError class
    // (apps/mobile/data/api.ts). Anything that keys off `instanceof` reports
    // every mobile failure as "not a conflict", which is the defect this
    // duck-typed rule exists to avoid.
    class ForeignApiError extends Error {
      status = 409;
      body = { code: "revision_conflict", resource_type: "comment" };
    }
    expect(isRevisionConflict(new ForeignApiError("nope"))).toBe(true);

    // …and a plain object with the same shape works too.
    expect(isRevisionConflict({ status: 409, body: { code: REVISION_CONFLICT_CODE } }))
      .toBe(true);
  });

  it("stays out of every other 409 on the same endpoints", () => {
    // Same status, different situation. Reporting these as a lost update tells
    // the member to compare two versions that never diverged.
    expect(isRevisionConflict(STATUS_ARCHIVE_RACE)).toBe(false);
    expect(isRevisionConflict(DUPLICATE_TARGET)).toBe(false);
  });

  it("does not treat a code-less 409 as a conflict", () => {
    // The aggregate path always sends a code; the only code-less 409 here is
    // the status-archive race above, whose own message is the actionable one.
    expect(isRevisionConflict({ status: 409, body: {} })).toBe(false);
    expect(isRevisionConflict({ status: 409 })).toBe(false);
  });

  it("does not treat the same code on a non-409 as a conflict", () => {
    // Guards the reverse mistake: a body echoed back on a 200/500 carrying a
    // stale `code` field. The status is not how we decide, but a success is
    // not a refusal either.
    expect(isRevisionConflict({ status: 200, body: { code: REVISION_CONFLICT_CODE } }))
      .toBe(false);
  });

  it("survives everything that is not an error object", () => {
    expect(isRevisionConflict(null)).toBe(false);
    expect(isRevisionConflict(undefined)).toBe(false);
    expect(isRevisionConflict("409")).toBe(false);
    expect(isRevisionConflict(new Error("Revision conflict"))).toBe(false);
    expect(isRevisionConflict({ status: 409, body: "revision_conflict" })).toBe(false);
    expect(isRevisionConflict({ status: 409, body: { code: "" } })).toBe(false);
    expect(isRevisionConflict({ status: 409, body: { code: 409 } })).toBe(false);
  });
});

describe("isDuplicateMarkConflict", () => {
  it("keeps the duplicate-mark refusals apart from a lost update", () => {
    expect(isDuplicateMarkConflict(DUPLICATE_TARGET)).toBe(true);
    expect(isDuplicateMarkConflict({ status: 409, body: { code: "issue_has_duplicates" } }))
      .toBe(true);
    expect(isDuplicateMarkConflict(AGGREGATE_CONFLICT)).toBe(false);
    expect(isDuplicateMarkConflict(STATUS_ARCHIVE_RACE)).toBe(false);
  });
});

describe("parseRevisionConflict", () => {
  it("reports both revisions from the aggregate shape", () => {
    expect(parseRevisionConflict(AGGREGATE_CONFLICT)).toEqual({
      resourceType: "comment",
      expectedRevision: 999999,
      actualRevision: 1,
    });
  });

  it("reports the resource with no revisions on the field shape", () => {
    expect(parseRevisionConflict(FIELD_CONFLICT)).toEqual({
      resourceType: "issue",
      expectedRevision: undefined,
      actualRevision: undefined,
    });
  });

  it("returns null for a failure that is not a conflict", () => {
    expect(parseRevisionConflict(DUPLICATE_TARGET)).toBeNull();
    expect(parseRevisionConflict(new Error("boom"))).toBeNull();
  });

  it("keeps a malformed revision out of the result", () => {
    // `NaN` would render as "expected 1, got NaN" in a message that claims to
    // describe what the server holds.
    const parsed = parseRevisionConflict({
      status: 409,
      body: {
        code: REVISION_CONFLICT_CODE,
        resource_type: "issue",
        expected_revision: "7",
        actual_revision: Number.NaN,
      },
    });
    expect(parsed).toEqual({
      resourceType: "issue",
      expectedRevision: undefined,
      actualRevision: undefined,
    });
  });

  it("names an unnamed resource rather than leaving the field blank", () => {
    const parsed = parseRevisionConflict({
      status: 409,
      body: { code: REVISION_CONFLICT_CODE },
    });
    expect(parsed?.resourceType).toBe("unknown");
  });
});

describe("errorCodeOf", () => {
  it("reads a non-empty string code", () => {
    expect(errorCodeOf(AGGREGATE_CONFLICT)).toBe("revision_conflict");
  });

  it("treats blank and non-string codes as absent", () => {
    expect(errorCodeOf({ body: { code: "" } })).toBeNull();
    expect(errorCodeOf({ body: { code: 0 } })).toBeNull();
    expect(errorCodeOf({ body: null })).toBeNull();
    expect(errorCodeOf({})).toBeNull();
    expect(errorCodeOf("code")).toBeNull();
  });
});
