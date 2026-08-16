/**
 * Issue-subscription selectors — pure functions shared by the Subscribe
 * control (issue-detail Activity header) and its optimistic cache patches.
 * Mirrors web's `useIssueSubscribers` derivation (packages/views/issues/
 * hooks/use-issue-subscribers.ts): the current member's row is found by
 * (user_type, user_id); anything else reads as "not subscribed".
 */
import type { IssueSubscriber } from "@multica/core/types";

export interface SubscriptionState {
  /** The signed-in member has a row in the subscriber list. */
  isSubscribed: boolean;
  /** That row's `reason`, if subscribed — `delegated` needs explaining. */
  reason?: string;
  /** True when subscribed *via* a delegated subscription (an agent created
   *  the issue on this member's behalf, MUL-5483). */
  isDelegated: boolean;
  /** Subscribers other than the signed-in member (for the avatar group). */
  others: IssueSubscriber[];
}

export function deriveSubscription(
  subscribers: IssueSubscriber[] | undefined,
  userId: string | null | undefined,
): SubscriptionState {
  const list = subscribers ?? [];
  const own = list.find(
    (s) => s.user_type === "member" && s.user_id === userId,
  );
  return {
    isSubscribed: !!own,
    reason: own?.reason,
    isDelegated: own?.reason === "delegated",
    others: list.filter((s) => !(s.user_id === userId && s.user_type === "member")),
  };
}

/**
 * Optimistic patch for the subscribers cache on a subscribe/unsubscribe
 * mutation — shared by the toggle and subtree mutations so the tricky
 * add-own-row / remove-own-row logic has a single tested home.
 *
 * `unsubscribing: true`  → drop the member's own row (opt-out).
 * `unsubscribing: false` → append a synthetic "manual" row for them (opt-in),
 * idempotent against double taps.
 */
export function patchSubscribersList(
  old: IssueSubscriber[] | undefined,
  issueId: string,
  userId: string | null | undefined,
  unsubscribing: boolean,
): IssueSubscriber[] {
  const list = old ?? [];
  if (!userId) return list;
  const isOwn = (s: IssueSubscriber) =>
    s.user_type === "member" && s.user_id === userId;
  if (unsubscribing) return list.filter((s) => !isOwn(s));
  if (list.some(isOwn)) return list;
  const self: IssueSubscriber = {
    issue_id: issueId,
    user_type: "member",
    user_id: userId,
    reason: "manual",
    created_at: new Date().toISOString(),
  };
  return [...list, self];
}