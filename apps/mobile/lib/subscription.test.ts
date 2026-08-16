import { describe, expect, it } from "vitest";
import type { IssueSubscriber } from "@multica/core/types";
import { deriveSubscription, patchSubscribersList } from "./subscription";

const sub = (
  userType: "member" | "agent",
  userId: string,
  reason: string = "manual",
): IssueSubscriber =>
  // The reason is deliberately open-ended in tests (matching the server's
  // parsing policy) — cast across the closed union.
  ({
    issue_id: "issue-1",
    user_type: userType,
    user_id: userId,
    reason,
    created_at: "2026-08-17T00:00:00Z",
  }) as IssueSubscriber;

describe("deriveSubscription", () => {
  it("reads as not subscribed on an unresolved (undefined) list", () => {
    const state = deriveSubscription(undefined, "user-1");
    expect(state.isSubscribed).toBe(false);
    expect(state.reason).toBeUndefined();
    expect(state.isDelegated).toBe(false);
  });

  it("finds the signed-in member among subscribers", () => {
    const state = deriveSubscription(
      [sub("member", "user-1"), sub("agent", "agent-x")],
      "user-1",
    );
    expect(state.isSubscribed).toBe(true);
    expect(state.reason).toBe("manual");
    expect(state.isDelegated).toBe(false);
  });

  it("does not count an agent row as a member subscription", () => {
    const state = deriveSubscription([sub("agent", "agent-x")], "agent-x");
    expect(state.isSubscribed).toBe(false);
  });

  it("flags a delegated subscription", () => {
    const state = deriveSubscription(
      [sub("member", "user-1", "delegated")],
      "user-1",
    );
    expect(state.isSubscribed).toBe(true);
    expect(state.isDelegated).toBe(true);
  });

  it("exposes other subscribers for the avatar group", () => {
    const state = deriveSubscription(
      [sub("member", "user-1"), sub("agent", "agent-x")],
      "user-1",
    );
    expect(state.others.map((s) => s.user_id)).toEqual(["agent-x"]);
  });

  it("stays lenient on an unrecognised reason (shared policy with core)", () => {
    const state = deriveSubscription(
      [sub("member", "user-1", "future-reason")],
      "user-1",
    );
    expect(state.isSubscribed).toBe(true);
    expect(state.isDelegated).toBe(false);
  });
});

describe("patchSubscribersList", () => {
  const existing = [sub("member", "user-2", "assignee")];

  it("appends a synthetic manual row when opting in (subscribe)", () => {
    const patched = patchSubscribersList(existing, "issue-1", "user-1", false);
    expect(patched).toHaveLength(2);
    const self = patched.find((s) => s.user_id === "user-1");
    expect(self?.user_type).toBe("member");
    expect(self?.reason).toBe("manual");
    expect(self?.issue_id).toBe("issue-1");
  });

  it("is idempotent when the member is already in the list", () => {
    const once = patchSubscribersList(existing, "issue-1", "user-1", false);
    const twice = patchSubscribersList(once, "issue-1", "user-1", false);
    expect(twice).toEqual(once);
    expect(twice.filter((s) => s.user_id === "user-1")).toHaveLength(1);
  });

  it("drops the member's own row when opting out (unsubscribe)", () => {
    const patched = patchSubscribersList(existing, "issue-1", "user-2", true);
    expect(patched).toEqual([]);
  });

  it("treats an undefined cache as [] and stays additive", () => {
    const patched = patchSubscribersList(undefined, "issue-1", "user-1", false);
    expect(patched).toHaveLength(1);
    expect(patched[0].user_id).toBe("user-1");
  });

  it("no-ops without a signed-in user id", () => {
    expect(patchSubscribersList(existing, "issue-1", null, false)).toBe(existing);
    expect(patchSubscribersList(existing, "issue-1", null, true)).toBe(existing);
  });

  it("keeps agent rows untouched when unsubscribing a member", () => {
    const withAgent = [...existing, sub("agent", "agent-x")];
    const patched = patchSubscribersList(withAgent, "issue-1", "user-2", true);
    expect(patched.some((s) => s.user_type === "agent" && s.user_id === "agent-x")).toBe(true);
  });
});