/**
 * Appearance accessibility — the mobile side of web's Appearance >
 * 「减少动效」 and 「高对比度」 (MYS-2950).
 *
 * Web ships both as two switches at the bottom of `AppearanceTab`
 * (`packages/views/settings/components/appearance-tab.tsx`) and implements
 * them in `packages/core/appearance/index.ts`:
 *
 *   - **Reduce motion** — a preference in `AppearancePreferences`, applied as
 *     `animation-duration: 0.01ms !important` over `*, *::before, *::after`,
 *     ANDed at the React layer with `useReducedMotion()`, which returns
 *     `store.reduceMotion || systemReducedMotion()`. The `||` is the whole
 *     rule and it is transcribed below rather than re-invented: a union, never
 *     an override.
 *   - **High contrast** — recolours five tokens by mixing them toward the
 *     foreground (`color-mix(in oklab, var(--foreground) N%, var(--page-canvas))`).
 *     Mobile has three of those five tokens; the mixed values are precomputed
 *     in `lib/theme.ts` because React Native has no `color-mix()`.
 *
 * Iteration 296 refused both by name, with `density` and the theme gallery,
 * as things "RN cannot honour". That was right about density and wrong about
 * these two: RN can suppress animation (Reanimated takes a duration) and can
 * recolour tokens (they are plain strings). Correcting that refusal is the
 * point of this module, and the file header of
 * `app/(app)/[workspace]/more/settings/appearance.tsx` is updated with it.
 *
 * ── Why the rules live in a pure module ────────────────────────────────────
 *
 * Every decision below is a thing a *screen* would have to get right in three
 * places at once (the switch's appearance, the animation call sites, the
 * palette). Mobile's vitest lane is Node-only — there is no renderer to mount
 * a component and read back what a person would see (see vitest.config.ts) —
 * so the honest place to pin the behaviour is a function that takes the two
 * booleans and returns the decision. The wiring tests then prove those
 * functions are actually reached.
 */
/**
 * The two inputs, named rather than positional, because swapping them is the
 * exact defect this module exists to prevent and `f(user, system)` invites it.
 *
 * `system` is `boolean | undefined` on purpose: `AccessibilityInfo`'s
 * `isReduceMotionEnabled()` is asynchronous, so there is a real window on cold
 * start where the system's answer is not known yet. `undefined` reads as
 * "no system preference" — never as permission to animate over a user who set
 * the app switch, and never as suppression (which would freeze the first
 * frames of every launch for everyone without a reduce-motion setting).
 */
export interface MotionInputs {
  /** What the person set in Settings → Appearance. */
  user: boolean;
  /** The device's own reduce-motion setting, or `undefined` before it loads. */
  system: boolean | undefined;
}

/**
 * Whether motion should be suppressed. **The union, exactly as web computes
 * it** (`store.reduceMotion || systemReducedMotion()`).
 *
 * Writing this as `user` alone silently ignores a phone-level accommodation;
 * writing it as "the user switch overrides the system" is worse — it means
 * the moment someone touches the app's switch, the medical setting they set on
 * their phone stops applying. Both directions are pinned by tests.
 */
export function motionReduced({ user, system }: MotionInputs): boolean {
  return user || system === true;
}

/**
 * The same decision, for call sites that hold the raw inputs where one may be
 * missing. Kept as a separate name because `motionReduced` takes a fully
 * resolved pair and a reader should not have to guess which one to call.
 */
export function shouldSuppressMotion(inputs: MotionInputs): boolean {
  return motionReduced(inputs);
}

/** Where the effective "suppress motion" came from. */
export type MotionSource = "none" | "user" | "system";

export interface ReduceMotionRow {
  /** What the row's switch must render. */
  checked: boolean;
  /** True when the switch must not be turned off, because a higher power owns it. */
  locked: boolean;
  /** Who is responsible — drives the "已由系统开启" hint. */
  source: MotionSource;
}

/**
 * How the 「减少动效」 row renders. Three states, not two.
 *
 * The third state is the one this function exists for. When the phone asks for
 * reduced motion and the app switch is off, a plain `checked={user}` switch
 * reads **off while nothing animates** — so a person who wants animation back
 * taps it on, sees no change (already suppressed), taps again, and concludes
 * the setting is broken. Showing it checked, with the reason, tells the truth:
 * something above the app is holding this down.
 *
 * `system` wins the `source` label when both are on: turning the app switch
 * off would not restore motion while the phone still asks for none, so
 * presenting it as a user-owned choice would offer a control that does
 * nothing.
 */
export function reduceMotionRow({ user, system }: MotionInputs): ReduceMotionRow {
  const systemOn = system === true;
  if (systemOn) return { checked: true, locked: true, source: "system" };
  if (user) return { checked: true, locked: false, source: "user" };
  return { checked: false, locked: false, source: "none" };
}

/**
 * The duration to hand Reanimated / an Animated timing config.
 *
 * Reduced motion collapses the duration to **0**, and that is deliberately not
 * "skip the animation": a `withTiming(cb)` whose anim is never started also
 * never runs its completion callback, so the state transitions those callbacks
 * carry (closing a panel, clearing a highlight) would never fire. Reanimated
 * runs a 0-duration timing immediately and still calls back, which is exactly
 * the "instantly there, but you still arrive" semantics web gets from
 * `animation-duration: 0.01ms`.
 *
 * Non-finite and negative inputs collapse to 0 rather than being forwarded:
 * a negative duration is an error on Android and "keep the current value"
 * elsewhere, and `NaN` animates nothing with no warning at all. Callers pass
 * literals today, so this is the guard for the first caller that computes one.
 */
export function resolvedMotionDuration(
  duration: number,
  reduced: boolean,
): number {
  if (reduced) return 0;
  if (!Number.isFinite(duration) || duration < 0) return 0;
  return duration;
}

/**
 * Whether a REPEATING animation should run at all.
 *
 * A repeat needs a different answer from a one-shot, and getting it wrong is
 * the trap in "just set every duration to zero": an infinite
 * `withRepeat(withTiming(0), -1)` does not stop, it schedules a zero-length
 * frame forever — burning the UI thread to animate nothing, and with
 * `reverse: true` producing a visible strobe at whatever rate the frame
 * callback fires. Web's stylesheet sidesteps this with
 * `animation-iteration-count: 1 !important`, which turns a repeat into a
 * single pass; the RN equivalent is to not start it.
 *
 * The caller settles on a static resting value instead — which is also the
 * more useful rendering: a pulsing "working" dot becomes a steady dot, and a
 * breathing status line becomes plain text. The information is still there.
 */
export function shouldRepeatMotion(reduced: boolean): boolean {
  return !reduced;
}

/**
 * The tokens the high-contrast palette raises. Web mixes five; these are the
 * three mobile actually defines (there is no `--faint-foreground` or
 * `--surface-border` in `apps/mobile/global.css`).
 *
 * Deliberately a closed list rather than "every token": high contrast means
 * MORE separation between text/rules and the page, and raising a surface fill
 * would flatten the elevation ladder instead. `lib/appearance-a11y.test.ts`
 * checks each name exists in the base palette, so a typo cannot silently
 * produce an `undefined` colour.
 */
export const HIGH_CONTRAST_TOKENS = ["mutedForeground", "border", "input"] as const;

export type HighContrastToken = (typeof HIGH_CONTRAST_TOKENS)[number];

/**
 * The high-contrast values, one per token per scheme.
 *
 * **Derived by arithmetic, not by eye — and deliberately NOT web's numbers.**
 *
 * Web's rule (`appearanceStylesheet`) is
 * `color-mix(in oklab, var(--foreground) N%, var(--page-canvas))` with a fixed
 * N per token (80 muted / 40 input / 22 border). Copying those Ns onto mobile
 * does not reproduce web's result, because the two apps' base tokens and page
 * colours differ, and on mobile it produced a *worse* dark mode: `border` at
 * 22% lands on L 20.8 against a L 3.9 page, which is 1.62:1 — LESS separation
 * than the L 25 (1.90:1) it replaced. That is the palette failing its own
 * purpose, so the shares below were solved for instead.
 *
 * The rule used, per token, mixing the scheme's own `foreground` toward its
 * own `background` (mobile's `--page-canvas`):
 *
 *   - `mutedForeground` must clear **WCAG AAA 7:1** against the page, and must
 *     improve on the base token by at least 20 %. The second clause is what
 *     keeps dark mode honest: its base muted text is already 7.85:1, so a
 *     pure floor of 7 would have moved it *backwards*.
 *   - `input` must clear **WCAG 1.4.11's 3:1** non-text minimum — it is the
 *     outline a person has to find to type.
 *   - `border` must clear 2:1 and improve by 35 %. It is deliberately weaker
 *     than `input`: a divider that reached 3:1 would read as a second input
 *     on every card, which is why the two tokens differ in the base palette's
 *     intent even though they share a value there.
 *
 * Solved values (share of foreground → resulting lightness → measured ratio):
 *
 *   light (fg L 3.9, bg L 100):  muted 63% → L 34.6 (7.09) · input 39% → L 58.0 (3.04) · border 26% → L 71.5 (2.02)
 *   dark  (fg L 98,  bg L 3.9):  muted 74% → L 70.1 (9.43) · input 40% → L 36.7 (3.04) · border 36% → L 33.1 (2.63)
 *
 * Both palettes are achromatic, so the mix carries no hue and is written back
 * as `hsl(0 0% L%)` rather than reporting float noise as a hue.
 *
 * Colours ONLY. No size, weight, spacing or radius appears here — the
 * high-contrast switch must not stack a second scale on top of iteration 296's
 * `--font-scale`, which is how the MYS-2559 clipping defect was born.
 */
const HIGH_CONTRAST_PALETTE: Record<"light" | "dark", Record<HighContrastToken, string>> = {
  light: {
    mutedForeground: "hsl(0 0% 34.6%)",
    border: "hsl(0 0% 71.5%)",
    input: "hsl(0 0% 58%)",
  },
  dark: {
    mutedForeground: "hsl(0 0% 70.1%)",
    border: "hsl(0 0% 33.1%)",
    input: "hsl(0 0% 36.7%)",
  },
};

/**
 * The palette override for a scheme, as a plain object ready to spread over
 * `THEME[scheme]`.
 *
 * Returned as a copy every call rather than the stored object: a caller that
 * mutated the result would otherwise corrupt the palette for the rest of the
 * process, and the shape is three strings — the copy costs nothing.
 */
export function highContrastTokens(
  scheme: "light" | "dark",
): Record<HighContrastToken, string> {
  return { ...HIGH_CONTRAST_PALETTE[scheme] };
}

/**
 * A scheme's palette with the high-contrast tokens applied.
 *
 * Takes the base palette as an argument rather than importing `lib/theme.ts`,
 * and that is load-bearing rather than stylistic: this module is read by
 * mobile's Node-only vitest lane, and `lib/theme.ts` imports
 * `@react-navigation/native`, whose published package maps `source` to its
 * `.tsx` originals — importing it would drag a React Native type surface into
 * a runner that cannot parse it. Keeping the arithmetic dependency-free is
 * what lets the palette be tested at all; a wiring guard then proves the app
 * calls this with the real `THEME`.
 *
 * The scheme is passed explicitly rather than sniffed from the palette: the
 * two palettes have the same shape, and guessing from a colour would silently
 * paint light-mode greys on a dark page the day a token changes.
 */
export function applyHighContrast<T extends Record<string, unknown>>(
  base: T,
  scheme: "light" | "dark",
  highContrast: boolean,
): T {
  if (!highContrast) return base;
  return { ...base, ...highContrastTokens(scheme) };
}
