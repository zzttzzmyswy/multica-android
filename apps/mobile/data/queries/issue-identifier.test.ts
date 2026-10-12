/**
 * `issueIdentifierOptions` — the lookup behind the read-only identifier
 * autolink.
 *
 * Three behaviours matter, and each is a correctness rule rather than a
 * preference:
 *
 *   1. a MISS is an answer, not a failure. The server 404s an identifier that
 *      names no issue, and that must resolve to `null` so the caller keeps the
 *      author's plain text — not leave the query in `error`, where the global
 *      `retry: 1` would spend a second request on every genuinely-absent
 *      identifier and the caller would have to special-case an exception to
 *      render prose;
 *   2. the prefix gate must skip identifiers that could never resolve here
 *      (`UTF-8`, a part number), because those are the majority of the
 *      non-matching candidates on this deployment;
 *   3. an unknown prefix must NOT gate anything out — the workspace list is
 *      still loading on a cold start, and gating on a not-yet-known prefix
 *      would leave every identifier unlinked until it arrived.
 *
 * The fetch goes through `getIssue`, not `searchIssues`: search pages an index
 * and can miss an exact identifier outside its window, while the detail
 * endpoint resolves one directly.
 */
import { describe, expect, it, vi } from "vitest";

const { mockGetIssue } = vi.hoisted(() => ({ mockGetIssue: vi.fn() }));

vi.mock("@/data/api", () => ({
  api: { getIssue: mockGetIssue },
}));

import { issueIdentifierOptions } from "./issues";

const ISSUE = { id: "01a12e65-9ed5-7e40-a2f1-363fdea817bc", identifier: "MYS-2109" };

/** Invoke an option's `queryFn` the way TanStack Query does — with a context
 *  carrying `signal` — since it destructures its argument. */
function runQueryFn(opts: { queryFn?: unknown }): Promise<unknown> {
  const fn = opts.queryFn as (ctx: { signal: AbortSignal }) => Promise<unknown>;
  return fn({ signal: new AbortController().signal });
}

describe("issueIdentifierOptions", () => {
  it("keys the identifier under the workspace issue prefix", () => {
    const opts = issueIdentifierOptions("ws-1", "MYS-2109", "MYS");
    expect(opts.queryKey).toEqual(["issues", "ws-1", "identifier", "MYS-2109"]);
  });

  it("resolves through getIssue — the endpoint that takes an identifier", async () => {
    mockGetIssue.mockResolvedValue(ISSUE);
    const opts = issueIdentifierOptions("ws-1", "MYS-2109", "MYS");
    await expect(runQueryFn(opts)).resolves.toEqual(ISSUE);
    expect(mockGetIssue).toHaveBeenCalledWith("MYS-2109", expect.anything());
  });

  it("resolves a 404 to null instead of throwing", async () => {
    // The miss is the answer: the caller renders the identifier as plain text.
    mockGetIssue.mockRejectedValue(new Error("issue not found"));
    const opts = issueIdentifierOptions("ws-1", "MYS-99999", "MYS");
    await expect(runQueryFn(opts)).resolves.toBeNull();
  });

  it("disables the query when there is no workspace", () => {
    const opts = issueIdentifierOptions(null, "MYS-2109", "MYS");
    expect(opts.enabled).toBe(false);
  });

  it("disables the query for a non-identifier token", () => {
    const opts = issueIdentifierOptions("ws-1", "not-an-id", "MYS");
    expect(opts.enabled).toBe(false);
  });

  it("disables the query when the prefix cannot match this workspace", () => {
    // `UTF-8` and part numbers like `MT62F4G32D8DV-4` are real occurrences in
    // this deployment's prose that can never resolve here.
    expect(issueIdentifierOptions("ws-1", "UTF-8", "MYS").enabled).toBe(false);
    expect(issueIdentifierOptions("ws-1", "MUL-1", "MYS").enabled).toBe(false);
  });

  it("accepts a matching prefix case-insensitively", () => {
    expect(issueIdentifierOptions("ws-1", "MYS-2109", "mys").enabled).toBe(true);
  });

  it("does NOT gate on an unknown prefix (cold start, list still loading)", () => {
    expect(issueIdentifierOptions("ws-1", "MYS-2109", undefined).enabled).toBe(true);
    expect(issueIdentifierOptions("ws-1", "MYS-2109", "").enabled).toBe(true);
    expect(issueIdentifierOptions("ws-1", "MYS-2109", null).enabled).toBe(true);
  });

  it("caches the mapping, since identifier→issue is effectively immutable", () => {
    expect(issueIdentifierOptions("ws-1", "MYS-2109", "MYS").staleTime).toBe(
      5 * 60_000,
    );
  });
});
