import { MutationCache, MutationObserver, QueryClient } from "@tanstack/query-core";
import { describe, expect, it, vi } from "vitest";
import {
  WRITE_FAILURE_CONFLICT_CODE_KEY,
  WRITE_FAILURE_CONFLICT_KEY,
  WRITE_FAILURE_TITLE_KEY,
  reportWriteFailure,
  type WriteFailureAlerter,
} from "./write-failure";

/**
 * The 409 substitution, narrowed to a server CODE (MYS-2132).
 *
 * `PUT /api/issues/:id` answers 409 for three unrelated reasons, and only one of
 * them is a lost update:
 *
 *   revision_conflict            → "someone edited this; compare versions"
 *   (no code) status-archive race → "reload the status list and retry"
 *   duplicate_target_is_duplicate → "pick the original instead"
 *
 * Before this, the substitution keyed off the status alone, so a titled mutation
 * that pinned a conflict line would have shown the lost-update sentence for all
 * three — replacing the one sentence that says what to do with one that names a
 * race which never happened. These tests drive the real MutationCache, so they
 * fail if the narrowing is ever unwound.
 */

const translate = (id: string) => `t:${id}`;

function makeClient(alert: WriteFailureAlerter) {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) =>
        reportWriteFailure(error, mutation, translate, alert),
    }),
    defaultOptions: { mutations: { retry: false } },
  });
}

/** A failed request carrying whatever body the case needs.
 *
 *  The message is taken from the body's `error` field, which is what the real
 *  transport does (`apps/mobile/data/api.ts`: the server's envelope is
 *  `{"error": "..."}` and `fetch` lifts it onto `ApiError.message`). A helper
 *  that left a placeholder message here would test the fallback rather than the
 *  pass-through it is meant to check. */
function conflict(status: number, body: unknown) {
  const record =
    typeof body === "object" && body !== null
      ? (body as { error?: unknown })
      : null;
  const message =
    typeof record?.error === "string" ? record.error : `HTTP ${status}`;
  return Object.assign(new Error(message), { status, body });
}

/** Fires one failing mutation through a real observer and returns the alert spy. */
async function fire(error: unknown, meta: Record<string, unknown>) {
  const alert = vi.fn<WriteFailureAlerter>();
  const client = makeClient(alert);
  const observer = new MutationObserver(client, {
    mutationFn: () => Promise.reject(error),
    meta,
  });
  observer.subscribe(() => {});
  await observer.mutate().catch(() => {});
  await new Promise((r) => setTimeout(r, 10));
  return alert;
}

/** `useUpdateIssue`'s meta, which is what this narrowing exists for. */
const UPDATE_ISSUE_META = {
  [WRITE_FAILURE_TITLE_KEY]: "editIssue.failedTitle",
  [WRITE_FAILURE_CONFLICT_KEY]: "revision.conflict",
  [WRITE_FAILURE_CONFLICT_CODE_KEY]: "revision_conflict",
};

describe("a code-pinned conflict line replaces only its own code", () => {
  it("substitutes on the revision conflict", async () => {
    const alert = await fire(
      conflict(409, { code: "revision_conflict", resource_type: "issue" }),
      UPDATE_ISSUE_META,
    );

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[0]).toBe("t:editIssue.failedTitle");
    expect(alert.mock.calls[0]?.[1]).toBe("t:revision.conflict");
  });

  it("keeps the server's own message for the status-archive race", async () => {
    // Same status, no code. The API's sentence is the actionable one — it says
    // to reload the status list, which the conflict line does not.
    const alert = await fire(
      conflict(409, {
        error:
          "the target status was archived while this request was in flight; reload the status list and retry",
      }),
      UPDATE_ISSUE_META,
    );

    expect(alert.mock.calls[0]?.[1]).toBe(
      "the target status was archived while this request was in flight; reload the status list and retry",
    );
  });

  it("keeps the server's own message for a duplicate-mark refusal", async () => {
    const alert = await fire(
      conflict(409, {
        code: "duplicate_target_is_duplicate",
        error: "the target issue is itself a duplicate",
      }),
      UPDATE_ISSUE_META,
    );

    expect(alert.mock.calls[0]?.[1]).toBe("the target issue is itself a duplicate");
  });

  it("still substitutes for a mutation that pinned no code", async () => {
    // The opt-in direction: saved views and wakeup rules emit exactly one kind
    // of 409 and their bodies carry no code at all, so narrowing THEM would
    // silently drop the substitution they have always had.
    const alert = await fire(conflict(409, { error: "view was modified by someone else" }), {
      [WRITE_FAILURE_TITLE_KEY]: "issueViews.saveFailed",
      [WRITE_FAILURE_CONFLICT_KEY]: "issueViews.saveConflict",
    });

    expect(alert.mock.calls[0]?.[1]).toBe("t:issueViews.saveConflict");
  });

  it("does not substitute on a non-409 that happens to carry the code", async () => {
    const alert = await fire(
      conflict(500, { code: "revision_conflict", error: "boom" }),
      UPDATE_ISSUE_META,
    );

    expect(alert.mock.calls[0]?.[1]).toBe("boom");
  });

  it("passes an ordinary failure through untouched", async () => {
    const alert = await fire(new Error("Failed to fetch"), UPDATE_ISSUE_META);
    expect(alert.mock.calls[0]?.[1]).toBe("Failed to fetch");
  });
});
