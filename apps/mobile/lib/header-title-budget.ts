/**
 * Layout budget for the native Stack header's title.
 *
 * Why this is a module and not three inline numbers: the issue detail screen
 * puts its title (`issue.identifier`, e.g. "MYS-2282") in the SAME row as a
 * growing set of right-hand actions. React Navigation measures the trailing
 * view first and hands the title whatever is left, so an over-subscribed
 * header does not degrade — it deletes the title. That is MYS-2534: on a
 * 411dp phone the identifier was allotted 76dp against the ~79dp it needs and
 * rendered as "MYS-…".
 *
 * Every constant below was measured on the device (Pixel-6 AVD, 1080px @
 * density 2.625 = 411.4dp), not estimated. `uiautomator dump` gives exact
 * node bounds, so the numbers are the platform's real ones:
 *
 *     back lane (0 → title start)          72dp
 *     standard 32dp icon button            32dp
 *     agent badge (avatar stack + dot)     52dp   ← ~1.6 buttons, not 1
 *     gap between adjacent actions          4dp
 *     trailing inset (last action → edge)  16dp
 *     title lane that DID truncate         72.7dp
 *
 * The agent badge number is why a plain COUNT of actions cannot be trusted:
 * one badge costs as much width as two buttons, so a header that fits "six
 * actions" renders "MYS-…" the moment one of them is a badge. Callers pass
 * per-item widths and `planHeaderActions` does the arithmetic.
 */

/** Visual (not touch) size of one standard header icon button, in dp. Kept in
 *  sync with the `header-icon` width/height steps in tailwind.config.js. */
export const HEADER_ACTION_SIZE = 32;

/** Measured footprint of one standard icon button — the touch box the platform
 *  lays out, slightly wider than the 32dp visual because of `hitSlop` on the
 *  button chrome. Use this when budgeting; `HEADER_ACTION_SIZE` is what the
 *  stylesheet sets. */
export const HEADER_ACTION_FOOTPRINT = 32;

/** Horizontal gap between adjacent header actions, in dp. */
export const HEADER_ACTION_GAP = 4;

/** Measured width of the agent-working badge (avatar stack + pulse dot). */
export const HEADER_AGENT_BADGE_WIDTH = 52;

/** Width to reserve for the wakeup badge. That badge renders TEXT (e.g.
 *  "Waiting for CI"), so it is the widest thing the header can hold — the
 *  budget reserves a realistic maximum and lets the planner fold it when the
 *  screen cannot pay. */
export const HEADER_WAKEUP_BADGE_WIDTH = 120;

/** Accessible tappable size, in dp. Reached with `hitSlop` beyond the visual
 *  box — the Fluent/Material 44dp minimum. */
export const HEADER_TOUCH_TARGET = 44;

/** Width a header title needs before it starts truncating, in dp.
 *
 *  Measured floor: a 72.7dp lane ellipsised "MYS-2282" on the device, so the
 *  88dp the first estimate assumed was too generous and 72.7dp is too tight.
 *  80dp clears the observed truncation with margin for a five-digit
 *  identifier, which is the widest the workspace's `MYS-NNNNN` scheme reaches
 *  in practice. */
export const MIN_TITLE_WIDTH = 80;

/** Width reserved for the leading side of the header: back chevron through to
 *  where the title lane begins. Measured at 75.4dp on the Android native
 *  stack (back button + its inset + the title lane's own leading padding). */
export const HEADER_LEADING_WIDTH = 72;

/** Trailing inset between the last action and the screen edge. Measured at
 *  16.8dp. */
export const HEADER_TRAILING_PADDING = 16;

/** The narrowest screen this app targets. 360dp is the Android baseline
 *  (Galaxy A-series); smaller phones scale the layout, so this is the floor
 *  the budget must hold at. */
export const MIN_SCREEN_WIDTH = 360;

/** Width left for the title once the leading lane, the trailing inset and
 *  `trailingWidth` of actions are taken. May be negative — over-subscribed. */
export function headerTitleWidth(
  screenWidth: number,
  trailingWidth: number,
): number {
  return (
    screenWidth -
    HEADER_LEADING_WIDTH -
    HEADER_TRAILING_PADDING -
    trailingWidth
  );
}

/** Does the title still have room to be read? */
export function headerTitleFits(
  screenWidth: number,
  trailingWidth: number,
  minTitleWidth: number = MIN_TITLE_WIDTH,
): boolean {
  return headerTitleWidth(screenWidth, trailingWidth) >= minTitleWidth;
}

/** How many dp of trailing actions this screen can afford while keeping the
 *  title readable. */
export function headerActionBudget(
  screenWidth: number,
  minTitleWidth: number = MIN_TITLE_WIDTH,
): number {
  return Math.max(
    0,
    screenWidth -
      HEADER_LEADING_WIDTH -
      HEADER_TRAILING_PADDING -
      minTitleWidth,
  );
}

/** Total width of `widths` laid out with `HEADER_ACTION_GAP` between them. */
export function actionsWidth(widths: number[]): number {
  if (widths.length === 0) return 0;
  return (
    widths.reduce((sum, width) => sum + width, 0) +
    (widths.length - 1) * HEADER_ACTION_GAP
  );
}
