/**
 * The About page's update card decides what to say from three inputs: which
 * phase the check flow is in, what `checkForUpdate` concluded, and whether a
 * release payload arrived at all. That decision used to live inline in
 * `about.tsx`, where nothing could reach it — mobile's vitest lane has no RN
 * renderer, so an inline `if` chain is only testable by matching source text.
 *
 * It is extracted here for the same reason the realtime plan was extracted for
 * MYS-2178: the defect being fixed was a *branch* (`latestTag` → "up to date"),
 * and a branch is pinned by behaviour, not by the presence of a helper. In
 * particular, "the tag could not be read" has to reach the screen as its own
 * state — folding it into "no update" is exactly the bug.
 *
 * Pure over injected values; `i18nKey` maps each state to the message the card
 * renders, and is asserted against both locale bundles by
 * `lib/i18n/about-keys.test.ts`'s completeness harness.
 */

import type { UpdateCheck } from "./release-check";

/** How the update card is currently behaving (mirrors `about.tsx`'s CheckPhase). */
export type UpdatePhase =
  | "idle"
  | "checking"
  | "network-error"
  | "no-asset"
  | "foreign-package"
  | "downloading";

/** What the card should say. One per renderable message. */
export type UpdateState =
  | "checking"
  | "network-error"
  | "no-asset"
  | "foreign-package"
  | "downloading"
  | "update-available"
  | "up-to-date"
  | "unreadable"
  | "idle";

/** i18n key for each state. */
export const UPDATE_STATE_KEYS: Record<UpdateState, string> = {
  checking: "about.checking",
  "network-error": "update.error.network",
  "no-asset": "update.error.noAsset",
  "foreign-package": "update.error.foreignPackage",
  downloading: "about.downloading",
  "update-available": "about.updateAvailable",
  "up-to-date": "about.upToDate",
  unreadable: "update.error.unreadableTag",
  idle: "about.idle",
};

/**
 * Resolve the card's message.
 *
 * `check` is `null` until a release payload has arrived; `"unreadable"` means
 * one arrived but its tag could not be compared. Those are different: the
 * first is "we have not looked yet", the second is "we looked and cannot say",
 * and only the *third* possibility — a readable, non-newer tag — is "you are
 * on the latest version".
 *
 * Phase wins over `check` because a transport failure or an in-flight download
 * is the more specific thing to report.
 */
export function resolveUpdateState(
  phase: UpdatePhase,
  check: UpdateCheck | null,
): UpdateState {
  if (phase !== "idle") return phase;
  if (check === null) return "idle";
  if (check === "unreadable") return "unreadable";
  return check;
}

/**
 * Should the More popover's About row show its "new version" dot?
 *
 * Only for a check that actually concluded "update-available". `"unreadable"`
 * stays dark on purpose: the dot *asserts* that a newer release exists, and a
 * parse failure cannot back that assertion — lighting it would be the same
 * error as the original bug, pointed the other way (a false promise instead of
 * a false all-clear). `"up-to-date"` and "not checked yet" are equally dark.
 */
export function shouldShowUpdateBadge(check: UpdateCheck | null): boolean {
  return check === "update-available";
}
