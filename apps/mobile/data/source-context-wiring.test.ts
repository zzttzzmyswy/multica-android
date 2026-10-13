/**
 * Source-context wiring (MYS-2137) — the pieces that have to line up for the
 * feature to work end to end, and which a type check cannot catch:
 *
 *   - the query key sits under the prefix the write invalidates, and is keyed
 *     by COMMENT (two comments on one issue have two different threads and two
 *     different capture tokens);
 *   - the preview query is configured to REFETCH, because a cached capture
 *     token is a token the server may already consider stale;
 *   - the store the action sheet writes and the confirm route reads agree;
 *   - the mutation's settle invalidation reaches the four caches the write
 *     actually moves.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

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
import { commentSubIssuePreviewOptions } from "./queries/issues";
import { useSourceContextTargetStore } from "./stores/source-context-target-store";

const WS = "ws-1";

beforeEach(() => {
  useSourceContextTargetStore.getState().clear();
});

describe("the preview query key", () => {
  it("is keyed by the ANCHOR COMMENT, not the issue", () => {
    // The preview answers "what does THIS comment's thread look like". Two
    // comments on one issue have different threads and different capture
    // tokens, so an issue-keyed cache would serve one comment's token when the
    // member opened the other — and the server would refuse that create.
    const a = issueKeys.commentSubIssuePreview(WS, "comment-a");
    const b = issueKeys.commentSubIssuePreview(WS, "comment-b");
    expect(a).not.toEqual(b);
    expect(a).toContain("comment-a");
  });

  it("lives under the workspace's issue prefix, so a workspace switch drops it", () => {
    const key = issueKeys.commentSubIssuePreview(WS, "c1");
    expect(key.slice(0, issueKeys.all(WS).length)).toEqual([...issueKeys.all(WS)]);
    expect(key).not.toEqual(issueKeys.commentSubIssuePreview("ws-2", "c1"));
  });

  it("is NOT a child of `children`, which every sub-issue write invalidates", () => {
    // This is a read about a COMMENT. Sweeping it on every children
    // invalidation would refetch (and re-mint) a capture token the member is
    // still looking at.
    const key = issueKeys.commentSubIssuePreview(WS, "c1");
    expect(key).not.toContain("children");
    expect(key).toContain("source-context");
  });
});

describe("the preview query refetches rather than serving a cached token", () => {
  const opts = commentSubIssuePreviewOptions(WS, "c1");

  it("has staleTime 0", () => {
    // A cached `capture_token` is a proof of what the member was shown at some
    // EARLIER moment. If the source moved since, the server refuses the create
    // with 409 and the member is told to refresh — so serving the cache is what
    // creates the failure the token exists to prevent.
    expect(opts.staleTime).toBe(0);
  });

  it("refetches on every mount", () => {
    // `staleTime: 0` alone still lets a remount within the same tick reuse an
    // in-flight result, and the entire point is a fresh token per opening.
    expect(opts.refetchOnMount).toBe("always");
  });

  it("is disabled until both the workspace and the comment are known", () => {
    expect(commentSubIssuePreviewOptions(null, "c1").enabled).toBe(false);
    expect(commentSubIssuePreviewOptions(WS, "").enabled).toBe(false);
    expect(commentSubIssuePreviewOptions(WS, "c1").enabled).toBe(true);
  });

  it("does not sit under the duplicate-relation prefix", () => {
    // A duplicate mark invalidates that whole subtree. Capture tokens have
    // nothing to do with duplicate marks.
    const key = issueKeys.commentSubIssuePreview(WS, "c1");
    expect(key.slice(0, issueKeys.duplicatesAll(WS).length)).not.toEqual([
      ...issueKeys.duplicatesAll(WS),
    ]);
  });
});

describe("the target store is the channel the action sheet and route share", () => {
  it("round-trips the three values the confirm route needs", () => {
    useSourceContextTargetStore.getState().setTarget({
      commentId: "c1",
      issueId: "i1",
      issueIdentifier: "MYS-1",
    });
    const target = useSourceContextTargetStore.getState().target;
    expect(target).toEqual({
      commentId: "c1",
      issueId: "i1",
      issueIdentifier: "MYS-1",
    });
  });

  it("clears, so a second visit cannot render a previous comment's context", () => {
    // The confirm route clears on unmount, the same lifecycle
    // `reply-target-store` has. A stale target would render the previous
    // comment's source issue under the new comment's id.
    const store = useSourceContextTargetStore.getState();
    store.setTarget({ commentId: "c1", issueId: "i1" });
    expect(useSourceContextTargetStore.getState().target).not.toBeNull();
    useSourceContextTargetStore.getState().clear();
    expect(useSourceContextTargetStore.getState().target).toBeNull();
  });
});

describe("the mutation's settle invalidation reaches what the write moved", () => {
  const PARENT = "parent-1";

  // Read the hook's source rather than re-performing its calls: re-performing
  // them tests the QueryClient, not the hook — a change to the hook would leave
  // this green.
  const src = readFileSync(
    path.resolve(__dirname, "mutations/issues.ts"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  function hookBody(): string {
    const start = src.indexOf("export function useCreateCommentSubIssue(");
    expect(start, "useCreateCommentSubIssue not found").toBeGreaterThan(-1);
    const rest = src.slice(start + 1);
    const next = rest.indexOf("\nexport function ");
    return next === -1 ? rest : rest.slice(0, next);
  }

  it("refreshes the parent's children list — where the new sub-issue lands", () => {
    // The child is parented to the comment's own issue server-side, and that
    // list is a different query from the one the member is looking at.
    expect(hookBody()).toContain("issueKeys.children(wsId, vars.sourceIssueId)");
  });

  it("refreshes the parent's detail — its sub-issue counter moves", () => {
    expect(hookBody()).toContain("issueKeys.detail(wsId, vars.sourceIssueId)");
  });

  it("refreshes the parent's timeline — the server writes a capture activity", () => {
    expect(hookBody()).toContain("issueKeys.timeline(wsId, vars.sourceIssueId)");
  });

  it("refreshes child-progress, which drives the nested progress ring", () => {
    expect(hookBody()).toContain("issueKeys.childProgress(wsId)");
  });

  it("keys every one of those off the caller's sourceIssueId, not a comment id", () => {
    // A comment id cannot be turned into the parent issue's id client-side, so
    // a hook that assembled the key from `vars.commentId` would invalidate a
    // key nothing is cached under and refresh nothing at all.
    const body = hookBody();
    const invalidations = body.slice(body.indexOf("onSettled"));
    expect(invalidations).not.toContain("vars.commentId");
    expect(invalidations).toContain("vars.sourceIssueId");
  });

  it("builds only keys that exist on the key builder", () => {
    // Cheap guard against a renamed builder silently invalidating nothing.
    for (const name of ["children", "detail", "timeline", "childProgress", "list"]) {
      expect(typeof (issueKeys as unknown as Record<string, unknown>)[name]).toBe(
        "function",
      );
    }
    expect(issueKeys.children(WS, PARENT)).toContain(PARENT);
  });
});
