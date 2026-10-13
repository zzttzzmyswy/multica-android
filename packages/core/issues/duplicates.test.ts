import { describe, expect, it } from "vitest";

import type { Issue, IssueDuplicates, UpdateIssueRequest } from "../types";
import {
  DUPLICATE_STATUS,
  DUPLICATE_TARGET_IS_DUPLICATE,
  DUPLICATE_UNMARK_STATUS,
  DUPLICATE_WRITE_ONLY_FIELDS,
  ISSUE_HAS_DUPLICATES,
  canBeDuplicateOriginal,
  duplicateTargetExclusions,
  isDuplicateIssue,
  markDuplicatePatch,
  unmarkDuplicateIssue,
  unmarkDuplicatePatch,
} from "./duplicates";

/** The minimum an `isDuplicateIssue` caller holds. */
const partial = (
  status: string,
  duplicateOf: Issue["duplicate_of"],
): Pick<Issue, "status" | "duplicate_of"> => ({ status, duplicate_of: duplicateOf });

const ORIGINAL = { id: "orig", identifier: "MUL-1", title: "Original", status: "todo" };

/** A full `Issue`, for the candidate/exclusion helpers that take one. */
function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "dup",
    workspace_id: "ws",
    number: 2,
    identifier: "MUL-2",
    title: "Duplicate",
    description: null,
    status: "cancelled",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "u1",
    parent_issue_id: null,
    project_id: null,
    position: 0,
    stage: null,
    start_date: null,
    due_date: null,
    metadata: {},
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as Issue;
}

const relations = (duplicates: Issue[]): Pick<IssueDuplicates, "duplicates"> => ({
  duplicates,
});

describe("isDuplicateIssue", () => {
  it("counts a cancelled issue with a resolved original", () => {
    expect(isDuplicateIssue(partial("cancelled", ORIGINAL))).toBe(true);
  });

  it("does not count a cancelled issue the server resolved no original for", () => {
    // A plain cancelled issue is the ordinary case: the overwhelming majority
    // of cancelled issues duplicate nothing, and a banner on each would be a
    // lie with nothing to link to.
    expect(isDuplicateIssue(partial("cancelled", null))).toBe(false);
    expect(isDuplicateIssue(partial("cancelled", undefined))).toBe(false);
  });

  it("does not count a non-cancelled issue that still carries a pointer", () => {
    // The server clears the pointer when a mark leaves `cancelled`; an older
    // server may not have. Reading the pointer alone would draw a banner on
    // an issue nobody considers a duplicate any more.
    expect(isDuplicateIssue(partial("todo", ORIGINAL))).toBe(false);
    expect(isDuplicateIssue(partial("done", ORIGINAL))).toBe(false);
    expect(isDuplicateIssue(partial("in_progress", ORIGINAL))).toBe(false);
    expect(isDuplicateIssue(partial("blocked", ORIGINAL))).toBe(false);
  });

  it("keys on the exact cancelled key, not on a cancelled-category custom status", () => {
    // `status_category` is what a custom status inherits, but the mark is
    // written against the literal key the server stores. A workspace status
    // that merely behaves as cancelled is a different key and carries no mark.
    expect(isDuplicateIssue(partial("wont_fix", ORIGINAL))).toBe(false);
  });
});

describe("markDuplicatePatch", () => {
  it("writes the pointer and cancelled together", () => {
    const patch = markDuplicatePatch("orig");
    expect(patch).toEqual({
      status: "cancelled",
      duplicate_of_issue_id: "orig",
    });
    expect(patch.status).toBe(DUPLICATE_STATUS);
  });

  it("sends no other status, so the server cannot reject the pair", () => {
    // The server 400s a mark whose status is anything but cancelled; building
    // the patch here is what makes that impossible to get wrong at a call site.
    expect(Object.keys(markDuplicatePatch("orig")).sort()).toEqual([
      "duplicate_of_issue_id",
      "status",
    ]);
  });

  it("is a fresh object each call, so a caller cannot mutate a shared one", () => {
    const a = markDuplicatePatch("orig");
    const b = markDuplicatePatch("orig");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("unmarkDuplicatePatch", () => {
  it("is a plain status change out of cancelled", () => {
    // The server clears the pointer when the status leaves `cancelled`, and it
    // refuses a null pointer outright — so this is the only correct shape.
    expect(unmarkDuplicatePatch()).toEqual({ status: "todo" });
    expect(unmarkDuplicatePatch().status).toBe(DUPLICATE_UNMARK_STATUS);
  });

  it("never carries the write-only pointer field", () => {
    expect("duplicate_of_issue_id" in unmarkDuplicatePatch()).toBe(false);
  });
});

describe("DUPLICATE_WRITE_ONLY_FIELDS", () => {
  it("names the pointer, which is not a column on Issue", () => {
    expect([...DUPLICATE_WRITE_ONLY_FIELDS]).toEqual(["duplicate_of_issue_id"]);
  });

  it("names fields that exist on UpdateIssueRequest", () => {
    // Type-level `satisfies` already proves this; the runtime check keeps the
    // list honest if someone widens it to a string.
    const patch: UpdateIssueRequest = { duplicate_of_issue_id: "orig" };
    for (const field of DUPLICATE_WRITE_ONLY_FIELDS) {
      expect(field in patch).toBe(true);
    }
  });
});

describe("server error codes", () => {
  it("match the strings the server attaches", () => {
    // Pinned literally: a rename on either side must fail here rather than
    // silently downgrade the specific sentence to the generic one.
    expect(DUPLICATE_TARGET_IS_DUPLICATE).toBe("duplicate_target_is_duplicate");
    expect(ISSUE_HAS_DUPLICATES).toBe("issue_has_duplicates");
  });
});

describe("unmarkDuplicateIssue", () => {
  it("clears the status and the pointer together", () => {
    // They are one state server-side: a mark only counts while cancelled, so
    // clearing only the status would leave a row the server never returns — a
    // `todo` issue still holding an original.
    const out = unmarkDuplicateIssue(issue());
    expect(out.status).toBe("todo");
    expect(out.duplicate_of).toBeNull();
  });

  it("leaves an ordinary row untouched, by identity", () => {
    // Identity matters, not just equality: this is mapped over whole list
    // caches, and a fresh object per row would re-render the entire list for a
    // write that touched one issue.
    for (const status of ["todo", "done", "in_progress", "blocked", "backlog"]) {
      const plain = issue({ status });
      expect(unmarkDuplicateIssue(plain), status).toBe(plain);
    }
  });

  it("restores a cancelled issue the server resolved no original for", () => {
    // Only cancelled ISSUES are targets of an unmark, so this row must still
    // come out reopened even though `isDuplicateIssue` is false for it (no
    // pointer). Keying the guard on the mark alone would leave it cancelled.
    const out = unmarkDuplicateIssue(issue({ status: "cancelled", duplicate_of: null }));
    expect(out.status).toBe("todo");
    expect(out.duplicate_of).toBeNull();
  });

  it("also cleans a reopened row that still carries a stale pointer", () => {
    // The server clears the pointer on any status change, but an older one may
    // not have. Unmarking must not leave that combination behind.
    const stale = issue({ status: "todo", duplicate_of: ORIGINAL });
    const out = unmarkDuplicateIssue(stale);
    expect(out.status).toBe("todo");
    expect(out.duplicate_of).toBeNull();
    expect(out).not.toBe(stale);
  });

  it("preserves every other field", () => {
    const before = issue({ title: "Keep me", priority: "urgent" });
    const after = unmarkDuplicateIssue(before);
    expect(after.title).toBe("Keep me");
    expect(after.priority).toBe("urgent");
    expect(after.id).toBe(before.id);
  });

  it("is idempotent", () => {
    const once = unmarkDuplicateIssue(issue());
    expect(unmarkDuplicateIssue(once)).toBe(once);
  });
});

describe("canBeDuplicateOriginal", () => {
  it("rejects a candidate that is itself a duplicate", () => {
    expect(canBeDuplicateOriginal(issue({ duplicate_of: ORIGINAL }))).toBe(false);
  });

  it("accepts any other candidate, including cancelled and done ones", () => {
    // The picker searches with `include_closed: true`, so closed issues are
    // routine candidates — only a duplicate mark disqualifies one.
    expect(canBeDuplicateOriginal(issue({ status: "todo", duplicate_of: null }))).toBe(true);
    expect(canBeDuplicateOriginal(issue({ status: "done" }))).toBe(true);
    expect(canBeDuplicateOriginal(issue({ status: "cancelled", duplicate_of: null }))).toBe(true);
  });

  it("accepts a reopened issue that still carries a stale pointer", () => {
    expect(canBeDuplicateOriginal(issue({ status: "todo", duplicate_of: ORIGINAL }))).toBe(true);
  });
});

describe("duplicateTargetExclusions", () => {
  it("always excludes the issue itself", () => {
    expect(duplicateTargetExclusions("self", undefined)).toEqual(["self"]);
  });

  it("excludes the issue's own duplicates, one level deep", () => {
    const excluded = duplicateTargetExclusions("self", relations([
      issue({ id: "a" }),
      issue({ id: "b" }),
    ]));
    expect(excluded.sort()).toEqual(["a", "b", "self"]);
  });

  it("de-duplicates an issue that is somehow both self and a duplicate", () => {
    expect(duplicateTargetExclusions("self", relations([issue({ id: "self" })]))).toEqual(["self"]);
  });

  it("stays permissive while the relation has not been read", () => {
    // An unread relation is not "no duplicates": blocking the action while a
    // request is in flight would hide a valid choice for no reason. The server
    // still refuses a bad target, with a sentence the caller shows.
    expect(duplicateTargetExclusions("self", undefined)).toEqual(["self"]);
  });
});
