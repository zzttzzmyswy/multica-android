/**
 * Decide which trailing header actions the issue detail screen can afford.
 *
 * The screen's header carries up to seven actions, and React Navigation sizes
 * the title LAST — so an over-subscribed header does not degrade, it deletes
 * the title. MYS-2534 is that failure on a real device: "MYS-2282" rendered as
 * "MYS-…" because seven actions left it 76dp against the ~88dp it needs.
 *
 * The budget is in WIDTH, not in a count of buttons. The first attempt counted
 * actions and still shipped the bug, because two of the items are not buttons:
 * the agent badge measures 55dp (≈1.6 buttons) and the wakeup badge renders
 * text, so it is wider still. A header that "fits six actions" overdraws the
 * moment one of them is a badge.
 *
 * When the bar runs out of width it folds its LOW-frequency actions into the
 * overflow menu instead of letting the title collapse.
 *
 * What is never folded, and why:
 *
 *   - `overflow` — without it there is nowhere to fold anything to, and the
 *     issue's own actions (edit / relations / delete) become unreachable.
 *   - `search` — the navigator-wide entry point; it is the default
 *     `headerRight` for every other route, so dropping it here would make this
 *     the one screen where global search disappears.
 *   - the two badges — ambient STATUS, and status that has to be opened to be
 *     seen is not ambient. They are also absent from `present` when they would
 *     render nothing, so they cost nothing in the common case.
 *
 * The rest (`archive`, `threadNav`, `find`) has an equivalent inside the
 * overflow menu, so folding one costs a tap and nothing else.
 */
import {
  HEADER_ACTION_FOOTPRINT,
  HEADER_ACTION_GAP,
  HEADER_AGENT_BADGE_WIDTH,
  HEADER_WAKEUP_BADGE_WIDTH,
  headerActionBudget,
} from "./header-title-budget";

export type HeaderActionKey =
  | "search"
  | "archive"
  | "threadNav"
  | "find"
  | "agentBadge"
  | "wakeupBadge"
  | "overflow";

/** Order the actions appear in the bar, left to right. Declared once so the
 *  rendered order cannot drift from the order this module reasons about. */
export const HEADER_ACTION_DISPLAY_ORDER: HeaderActionKey[] = [
  "search",
  "archive",
  "threadNav",
  "find",
  "agentBadge",
  "wakeupBadge",
  "overflow",
];

/** Budgeted width of each action, in dp. Measured, not assumed — see
 *  `header-title-budget.ts`. */
const ACTION_WIDTH: Record<HeaderActionKey, number> = {
  search: HEADER_ACTION_FOOTPRINT,
  archive: HEADER_ACTION_FOOTPRINT,
  threadNav: HEADER_ACTION_FOOTPRINT,
  find: HEADER_ACTION_FOOTPRINT,
  agentBadge: HEADER_AGENT_BADGE_WIDTH,
  wakeupBadge: HEADER_WAKEUP_BADGE_WIDTH,
  overflow: HEADER_ACTION_FOOTPRINT,
};

/**
 * Which actions survive a budget squeeze, most expendable FIRST. Chosen on
 * (a) whether the overflow menu already offers the same thing, and (b) how
 * often a reader reaches for it. The wakeup badge goes before the agent badge:
 * a running task is a "wait for this" signal the reader checks constantly,
 * while a wakeup rule is a "come back later" fact.
 */
const FOLD_PRIORITY: HeaderActionKey[] = [
  "threadNav",
  "find",
  "archive",
  "wakeupBadge",
];

/** Never folded — see the module comment. */
const PINNED: HeaderActionKey[] = ["search", "agentBadge", "overflow"];

export interface HeaderActionPlan {
  /** Rendered in the bar, in display order. */
  visible: HeaderActionKey[];
  /** Needs an entry in the overflow menu because the bar had no room. */
  folded: HeaderActionKey[];
  /** Width the visible bar will consume, in dp. */
  width: number;
  /** Width available to the bar, in dp. */
  budget: number;
}

/** Layout width of a set of actions, gaps included. */
export function planWidth(keys: HeaderActionKey[]): number {
  if (keys.length === 0) return 0;
  return (
    keys.reduce((sum, key) => sum + ACTION_WIDTH[key], 0) +
    (keys.length - 1) * HEADER_ACTION_GAP
  );
}

/**
 * @param screenWidth  current window width in dp (`useWindowDimensions`)
 * @param present      which actions this issue actually has right now. Omit
 *                     the conditional ones (archive / badges) when they would
 *                     render null — an invisible badge must not reserve width.
 */
export function planHeaderActions(
  screenWidth: number,
  present: HeaderActionKey[],
): HeaderActionPlan {
  const budget = headerActionBudget(screenWidth);
  // Only actions that are both present and known to the bar; unknown keys are
  // dropped rather than rendered.
  const active = HEADER_ACTION_DISPLAY_ORDER.filter((key) =>
    present.includes(key),
  );

  const folded = new Set<HeaderActionKey>();
  // Fold until the bar fits. Walking FOLD_PRIORITY means the most expendable
  // action goes first, and each step is re-measured — a badge can free more
  // width than a button, so one fold sometimes finishes the job.
  for (const key of FOLD_PRIORITY) {
    if (planWidth(active.filter((k) => !folded.has(k))) <= budget) break;
    if (!active.includes(key) || PINNED.includes(key)) continue;
    folded.add(key);
  }

  const visible = active.filter((key) => !folded.has(key));
  return {
    visible,
    folded: active.filter((key) => folded.has(key)),
    width: planWidth(visible),
    budget,
  };
}
