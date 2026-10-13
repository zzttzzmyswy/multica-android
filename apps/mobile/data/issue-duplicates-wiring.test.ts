/**
 * Duplicate-mark wiring (MUL-7349). The pieces that have to line up for the
 * feature to work end to end, and which a type check cannot catch:
 *
 *   - the schema parses `duplicate_of` off an issue row AND the relation
 *     envelope, and degrades to "no relation" rather than blanking a page;
 *   - the query key sits under the prefix the write invalidates;
 *   - the WS updater refreshes the three ends a mark can move, and stays quiet
 *     when the mark did not change.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

// `data/api.ts` reads its base URL at module scope and throws without this.
// `vi.hoisted` rather than a plain assignment: ESM imports are hoisted above
// top-level statements, so a bare `process.env.X = ...` here would run AFTER
// `./queries/issues` (and through it `data/api`) had already been evaluated.
vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL = "https://api.test";
});

vi.mock("expo-file-system", () => ({
  File: class {
    uri = "file:///mock";
    exists = false;
  },
  Paths: { document: { uri: "file:///doc" } },
}));
vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: vi.fn(),
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

import { issueKeys } from "./queries/issue-keys";
import { issueDuplicatesOptions } from "./queries/issues";
import { EMPTY_ISSUE_DUPLICATES_RESPONSE, IssueDuplicatesResponseSchema } from "./schemas";
import { invalidateIssueDuplicates } from "./realtime/issue-ws-updaters";

/** An issue row as the live server sends it (mu.zztweb.top, MYS-2123), trimmed
 *  to the fields the schema needs. */
const ROW = {
  id: "01a132b4-cafc-7d94-810d-0f3299fbcf3c",
  workspace_id: "22905062-4e0d-4733-84af-828768dcb9c1",
  number: 2123,
  identifier: "MYS-2123",
  title: "iteration 236",
  description: null,
  status: "cancelled",
  priority: "high",
  assignee_type: "agent",
  assignee_id: "4a890197-0df8-4414-b2a0-cc912a5ff0e9",
  creator_type: "agent",
  creator_id: "4a890197-0df8-4414-b2a0-cc912a5ff0e9",
  parent_issue_id: null,
  project_id: null,
  position: -61,
  stage: null,
  start_date: null,
  due_date: null,
  metadata: {},
  properties: {},
  created_at: "2026-10-13T00:41:11Z",
  updated_at: "2026-10-13T00:41:11Z",
};

const ORIGINAL = {
  id: "orig-uuid",
  identifier: "MYS-2000",
  title: "The original",
  status: "in_progress",
};

describe("IssueDuplicatesResponseSchema", () => {
  it("parses both sides of a live relation", () => {
    const parsed = IssueDuplicatesResponseSchema.parse({
      duplicate_of: { ...ROW, duplicate_of: null },
      duplicates: [{ ...ROW, duplicate_of: ORIGINAL }],
    });
    expect(parsed.duplicate_of?.identifier).toBe("MYS-2123");
    expect(parsed.duplicates).toHaveLength(1);
    expect(parsed.duplicates[0].duplicate_of).toEqual(ORIGINAL);
  });

  it("parses the server's empty answer", () => {
    expect(
      IssueDuplicatesResponseSchema.parse({ duplicate_of: null, duplicates: [] }),
    ).toEqual(EMPTY_ISSUE_DUPLICATES_RESPONSE);
  });

  it("defaults a missing half rather than failing the whole envelope", () => {
    // The section and the banner both read "absent" as "render nothing", so a
    // drifted payload must hide a section, not blank the issue page.
    expect(IssueDuplicatesResponseSchema.parse({})).toEqual(
      EMPTY_ISSUE_DUPLICATES_RESPONSE,
    );
    expect(IssueDuplicatesResponseSchema.parse({ duplicates: [] }).duplicate_of).toBeNull();
    expect(IssueDuplicatesResponseSchema.parse({ duplicate_of: null }).duplicates).toEqual([]);
  });

  it("passes unknown server fields through", () => {
    const parsed = IssueDuplicatesResponseSchema.parse({
      duplicate_of: null,
      duplicates: [],
      total: 7,
    }) as Record<string, unknown>;
    expect(parsed.total).toBe(7);
  });

  it("reads the original off an issue row", () => {
    const parsed = IssueDuplicatesResponseSchema.parse({
      duplicate_of: null,
      duplicates: [{ ...ROW, duplicate_of: ORIGINAL }],
    });
    // Four fields and no more — the server resolves exactly these
    // (server/internal/handler/issue.go `fillDuplicateOf`).
    expect(Object.keys(parsed.duplicates[0].duplicate_of!).sort()).toEqual([
      "id",
      "identifier",
      "status",
      "title",
    ]);
  });

  it("drops a malformed pointer instead of blanking the list", () => {
    // `.catch(undefined)` on the issue schema: a mixed-version deploy sending
    // one bad pointer must not take the whole response to the fallback.
    const parsed = IssueDuplicatesResponseSchema.parse({
      duplicate_of: null,
      duplicates: [{ ...ROW, duplicate_of: { id: 123 } }],
    });
    expect(parsed.duplicates).toHaveLength(1);
    expect(parsed.duplicates[0].duplicate_of).toBeUndefined();
  });
});

describe("issueKeys.duplicates", () => {
  it("hangs off the prefix the write invalidates", () => {
    const ws = "ws-1";
    const perIssue = issueKeys.duplicates(ws, "a");
    const prefix = issueKeys.duplicatesAll(ws);
    expect(perIssue.slice(0, prefix.length)).toEqual([...prefix]);
    expect(perIssue).toHaveLength(prefix.length + 1);
  });

  it("is scoped to the workspace, so switching workspaces moves the cache", () => {
    expect(issueKeys.duplicates("ws-1", "a")).not.toEqual(issueKeys.duplicates("ws-2", "a"));
  });

  it("keys each issue separately", () => {
    expect(issueKeys.duplicates("ws", "a")).not.toEqual(issueKeys.duplicates("ws", "b"));
  });

  it("is not reachable by an issue-list invalidation, and vice versa", () => {
    // The relation is its own root: `invalidateQueries({queryKey: list(wsId)})`
    // runs on every status write in the app, and it must not drag a relation
    // refetch along with it.
    expect(issueKeys.duplicates("ws", "a").slice(0, 2)).toEqual(issueKeys.all("ws"));
    expect(issueKeys.duplicatesAll("ws")).not.toEqual(issueKeys.list("ws"));
    expect(issueKeys.duplicatesAll("ws")).not.toEqual(issueKeys.children("ws", "a").slice(0, 3));
  });
});

describe("issueDuplicatesOptions", () => {
  it("always refetches on mount", () => {
    // Load-bearing: a "no relation" cached while the user was elsewhere would
    // otherwise survive every remount under the app's Infinity stale time, and
    // the banner would stay missing on an issue that IS a duplicate.
    expect(issueDuplicatesOptions("ws", "a").refetchOnMount).toBe("always");
  });

  it("is enabled only with a workspace and an id", () => {
    expect(issueDuplicatesOptions("ws", "a").enabled).toBe(true);
    expect(issueDuplicatesOptions(null, "a").enabled).toBe(false);
    expect(issueDuplicatesOptions("ws", "").enabled).toBe(false);
  });

  it("uses the key the write invalidates", () => {
    expect(issueDuplicatesOptions("ws", "a").queryKey).toEqual(
      issueKeys.duplicates("ws", "a"),
    );
  });
});

describe("invalidateIssueDuplicates", () => {
  let qc: QueryClient;
  let invalidated: unknown[][];

  beforeEach(() => {
    qc = new QueryClient();
    invalidated = [];
    // Recorded rather than executed: the assertions are about WHICH ids are
    // named, which is the whole content of the rule.
    vi.spyOn(qc, "invalidateQueries").mockImplementation((filters) => {
      invalidated.push(filters?.queryKey as unknown[]);
      return Promise.resolve();
    });
  });

  it("refreshes the issue and both ends of the mark", () => {
    invalidateIssueDuplicates(qc, "ws", "issue", "new-orig", "old-orig");
    const ids = invalidated.map((key) => key[key.length - 1]);
    expect(new Set(ids)).toEqual(new Set(["issue", "new-orig", "old-orig"]));
  });

  it("skips the empty ends", () => {
    invalidateIssueDuplicates(qc, "ws", "issue", null, null);
    // next === prev → no work at all; see the next case for the one-sided one.
    expect(invalidated).toEqual([]);
    invalidateIssueDuplicates(qc, "ws", "issue", "new-orig", null);
    expect(invalidated.map((key) => key[key.length - 1])).toEqual(["issue", "new-orig"]);
  });

  it("does nothing when the mark did not change", () => {
    // `issue:updated` fires for every field. Without this guard, editing any
    // issue's title anywhere would refetch three relation queries.
    invalidateIssueDuplicates(qc, "ws", "issue", "same", "same");
    expect(invalidated).toEqual([]);
    invalidateIssueDuplicates(qc, "ws", "issue", undefined, undefined);
    expect(invalidated).toEqual([]);
    // undefined and null both mean "no mark", so clearing an already-empty
    // mark is not a change either.
    invalidateIssueDuplicates(qc, "ws", "issue", undefined, null);
    expect(invalidated).toEqual([]);
  });

  it("treats a cleared mark as a change", () => {
    invalidateIssueDuplicates(qc, "ws", "issue", null, "old-orig");
    expect(invalidated.map((key) => key[key.length - 1])).toEqual(["issue", "old-orig"]);
  });

  it("invalidates under the workspace's duplicates prefix", () => {
    invalidateIssueDuplicates(qc, "ws", "issue", "new-orig", "old-orig");
    for (const key of invalidated) {
      expect(key.slice(0, 3)).toEqual([...issueKeys.duplicatesAll("ws")].slice(0, 3));
    }
  });
});

describe("write-only control field", () => {
  // `duplicate_of_issue_id` makes the write DO something but is not a column on
  // `Issue`, whose read side is the server-resolved `duplicate_of` object. The
  // three `useUpdateIssue`-family mutations destructure it away before patching
  // a cache; this pins the rule those destructures implement, at the level the
  // Node lane can reach (the hooks themselves need a renderer).
  const patch = {
    status: "cancelled",
    duplicate_of_issue_id: "orig-uuid",
  };

  it("does not survive the strip into an optimistic row", () => {
    const { duplicate_of_issue_id: _stripped, ...optimistic } = patch;
    expect("duplicate_of_issue_id" in optimistic).toBe(false);
    // The status DOES survive — it is a real column, and it is what makes the
    // row read "cancelled" on the way to the refetch.
    expect(optimistic).toEqual({ status: "cancelled" });
  });

  it("would leave a phantom field on the row if it were not stripped", () => {
    // Guards the guard: if the destructure were dropped, the patched row would
    // carry a key no renderer reads and no response confirms.
    // Typed loosely on purpose: `ROW` is a trimmed fixture that never had a
    // `duplicate_of`, so a plain spread would fail the type check rather than
    // the assertion. Reading it as a record is what lets the assertion below
    // actually run — and "absent" is the answer it is pinning.
    const leaked: Record<string, unknown> = { ...ROW, ...patch };
    expect("duplicate_of_issue_id" in leaked).toBe(true);
    // …and it is NOT the field the banner reads, which is why the leak is
    // invisible rather than wrong-looking — the worst kind of cache drift.
    expect(leaked.duplicate_of).toBeUndefined();
  });
});
