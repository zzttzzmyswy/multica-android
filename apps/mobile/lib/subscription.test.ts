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

  // The picker (iteration 180 / G25) subscribes actors other than the signed-in
  // member, so the target type has to travel with the id. Every pre-existing
  // call site omits it and must keep its exact old "member" behaviour.
  describe("targeted patch (picker)", () => {
    it("defaults to a member row, preserving every pre-picker call site", () => {
      const patched = patchSubscribersList(existing, "issue-1", "user-9", false);
      const row = patched.find((s) => s.user_id === "user-9");
      expect(row?.user_type).toBe("member");
    });

    it("appends an agent row when the target is an agent", () => {
      const patched = patchSubscribersList(
        existing,
        "issue-1",
        "agent-9",
        false,
        "agent",
      );
      const row = patched.find((s) => s.user_id === "agent-9");
      expect(row?.user_type).toBe("agent");
      expect(row?.reason).toBe("manual");
    });

    it("drops an agent row on unsubscribe without touching same-id members", () => {
      // Ids are only unique WITHIN a type, so a member and an agent can share
      // one. Filtering on the id alone would drop the wrong row.
      const shared = [...existing, sub("agent", "user-2")];
      const patched = patchSubscribersList(
        shared,
        "issue-1",
        "user-2",
        true,
        "agent",
      );
      expect(patched.map((s) => `${s.user_type}:${s.user_id}`)).toEqual([
        "member:user-2",
      ]);
    });

    it("is idempotent per target type", () => {
      const once = patchSubscribersList(
        existing,
        "issue-1",
        "x-1",
        false,
        "agent",
      );
      const twice = patchSubscribersList(once, "issue-1", "x-1", false, "agent");
      expect(twice).toEqual(once);
    });

    it("treats a same-id member row as NOT the agent target", () => {
      // Subscribe agent "user-2" while member "user-2" is already subscribed:
      // the agent row must still be added, not suppressed as a duplicate.
      const patched = patchSubscribersList(
        existing,
        "issue-1",
        "user-2",
        false,
        "agent",
      );
      expect(patched).toHaveLength(2);
      expect(
        patched.some((s) => s.user_type === "agent" && s.user_id === "user-2"),
      ).toBe(true);
    });
  });
});