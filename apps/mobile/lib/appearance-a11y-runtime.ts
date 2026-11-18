/**
 * The runtime half of reduce-motion / high contrast (MYS-2950): the two hooks
 * a screen or an animation call site actually calls.
 *
 * The DECISIONS live in `lib/appearance-a11y.ts` as pure functions, because
 * mobile's vitest lane is Node-only and there is no renderer to read a
 * computed style back from (see vitest.config.ts). This file is the thin
 * adapter that feeds them real inputs — the persisted store and the device —
 * and it is deliberately small enough to review in one pass.
 *
 * ── Why the device preference is a module-level subscription ───────────────
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` is asynchronous, but it is a
 * property OF THE DEVICE, not of a component. Reading it per-hook would mean
 * one native round-trip per mounted component (the animation sites number
 * dozens) and each would race independently. Instead it is read once, cached
 * in a store, and kept current by `reduceMotionChanged` /
 * `highTextContrastChanged` — so every consumer reads the same answer at the
 * same time, and the answer updates even for components that mounted before
 * the first read resolved.
 *
 * `undefined` in the store means "not read yet". That is NOT the same as
 * `false`, and `lib/appearance-a11y.ts` treats it as "no system preference":
 * assuming `true` would freeze the first frames of every launch for everyone,
 * and assuming `false` permanently would ignore the setting entirely. Assuming
 * `false` *temporarily* is the only option that is wrong for nobody — the
 * first read resolves in a few milliseconds and corrects it.
 */
import { useEffect, useMemo } from "react";
import { AccessibilityInfo } from "react-native";
import { create } from "zustand";
import {
  applyHighContrast,
  motionReduced,
  reduceMotionRow,
  resolvedMotionDuration,
  type ReduceMotionRow,
} from "@/lib/appearance-a11y";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useAppearanceA11yStore } from "@/data/stores/appearance-a11y-store";

interface SystemMotionState {
  /** `undefined` until the first native read resolves. */
  reduceMotion: boolean | undefined;
  /** Android's "high contrast text" setting. `undefined` until read. */
  highContrast: boolean | undefined;
  started: boolean;
}

const useSystemMotionStore = create<SystemMotionState>(() => ({
  reduceMotion: undefined,
  highContrast: undefined,
  started: false,
}));

/**
 * Read the device's accessibility settings once and keep them current.
 *
 * Called at module load from `app/_layout.tsx` (via the hook below) rather than
 * from each consumer: the subscriptions must exist before the first animation
 * mounts, and only one set of native listeners should ever be registered.
 *
 * Every call is individually guarded. `isHighTextContrastEnabled` is an
 * Android-only API, and on a platform without it the promise rejects — an
 * unhandled rejection in a release build is a crash with no red box, which is
 * exactly the class of defect the boot breadcrumbs in `app/_layout.tsx` exist
 * for. A rejected read leaves the value `undefined`, which reads as "no
 * preference" and is the correct fallback.
 */
function startSystemMotionWatch(): void {
  if (useSystemMotionStore.getState().started) return;
  useSystemMotionStore.setState({ started: true });

  const read = () => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) =>
        useSystemMotionStore.setState({ reduceMotion: value === true }),
      )
      .catch(() => {
        // Leave `undefined` — "unknown" is the honest answer.
      });
    AccessibilityInfo.isHighTextContrastEnabled?.()
      .then((value) =>
        useSystemMotionStore.setState({ highContrast: value === true }),
      )
      .catch(() => {
        // iOS has no equivalent; `undefined` is correct there.
      });
  };

  read();

  // The `addEventListener` overload returns a subscription on RN 0.76+; the
  // removeEventListener form is kept as the teardown so this works on both.
  const reduceSub = AccessibilityInfo.addEventListener?.(
    "reduceMotionChanged",
    (value) => useSystemMotionStore.setState({ reduceMotion: value === true }),
  );
  const contrastSub = AccessibilityInfo.addEventListener?.(
    "highTextContrastChanged",
    (value) => useSystemMotionStore.setState({ highContrast: value === true }),
  );
  // Registered for the lifetime of the process, matching the module-level
  // store. There is intentionally no teardown path: this is started once from
  // the root layout, and unsubscribing on an unrelated unmount would silently
  // stop tracking the device setting for the rest of the session.
  void reduceSub;
  void contrastSub;
}

/**
 * Start the device watch from a component. Exposed as a hook (rather than an
 * import-time side effect) so the module can be imported by tests and by the
 * settings screen without registering native listeners as a side effect of an
 * import.
 */
export function useSystemMotionWatch(): void {
  useEffect(() => {
    startSystemMotionWatch();
  }, []);
}

/**
 * Whether animation should be suppressed right now — the union of the person's
 * switch and the device setting, exactly as web's `useReducedMotion()` computes
 * it (`store.reduceMotion || systemReducedMotion()`).
 *
 * Every `withTiming` / `withRepeat` / `FadeIn` call site in the app should use
 * the result to collapse its duration through `motionDuration()` below, rather
 * than branching on the store directly.
 */
export function useReducedMotion(): boolean {
  const user = useAppearanceA11yStore((s) => s.reduceMotion);
  const system = useSystemMotionStore((s) => s.reduceMotion);
  return motionReduced({ user, system });
}

/** `useReducedMotion` read once, for code outside render. */
export function prefersReducedMotion(): boolean {
  return motionReduced({
    user: useAppearanceA11yStore.getState().reduceMotion,
    system: useSystemMotionStore.getState().reduceMotion,
  });
}

/**
 * Collapse a duration when motion is reduced.
 *
 * The point of routing every call site through this instead of writing
 * `reduced ? 0 : 700` inline is the second argument of
 * `resolvedMotionDuration`: a computed duration can be `NaN` or negative, and
 * both are silent no-ops in Reanimated. One helper that clamps is a smaller
 * thing to get right than forty conditionals.
 */
export function motionDuration(duration: number, reduced: boolean): number {
  return resolvedMotionDuration(duration, reduced);
}


/**
 * The settings row's state — checked / locked / who owns it.
 *
 * `useReducedMotionRow` exists separately from `useReducedMotion` because the
 * two answer different questions: "should this animate?" (a boolean the
 * animation sites want) and "what should this switch show, and can it be
 * turned off?" (three states, one of which the person cannot change).
 */
export function useReducedMotionRow(): ReduceMotionRow {
  const user = useAppearanceA11yStore((s) => s.reduceMotion);
  const system = useSystemMotionStore((s) => s.reduceMotion);
  return reduceMotionRow({ user, system });
}

/** The device is holding motion down, so the app switch cannot restore it. */
export function useSystemReduceMotion(): boolean {
  return useSystemMotionStore((s) => s.reduceMotion) === true;
}

/** The device asks for high contrast text (Android). `undefined` = unknown. */
export function useSystemHighContrast(): boolean | undefined {
  return useSystemMotionStore((s) => s.highContrast);
}

/**
 * The palette a surface should paint with — base tokens, or base plus the
 * high-contrast overrides.
 *
 * This is the ONE accessor for inline colours (~560 call sites: Ionicons
 * `color=`, TextInput borders, ActivityIndicator, Switch tracks). It exists
 * because NativeWind's `vars()`/`contrast-more` reach only the `className`
 * sites; an inline `style={{ color: THEME[scheme].mutedForeground }}` never
 * consults a CSS variable, so without this the app would gain contrast on its
 * text and keep its icons dim — the "half the screen changed" state.
 *
 * A hook rather than a plain function because a plain function reading a
 * module-level flag would not re-render its caller when the setting flips,
 * and would tear under concurrent rendering.
 */
export function useThemePalette(): typeof THEME.light {
  // Reads the three inputs directly rather than calling `useAppearanceA11y`:
  // that hook also computes the motion decision, and subscribing to it here
  // would re-render every coloured surface in the app whenever an unrelated
  // animation preference changed.
  const { colorScheme } = useColorScheme();
  const user = useAppearanceA11yStore((s) => s.highContrast);
  const system = useSystemMotionStore((s) => s.highContrast);
  const highContrast = user || system === true;
  return useMemo(
    () => applyHighContrast(THEME[colorScheme], colorScheme, highContrast),
    [colorScheme, highContrast],
  );
}

export interface AppearanceA11y {
  /** The palette to paint with: base tokens, or base + high-contrast overrides. */
  theme: typeof THEME.light;
  /** Whether the high-contrast palette is in force (user OR device). */
  highContrast: boolean;
  /** Whether motion is suppressed (user OR device). */
  reduceMotion: boolean;
}

/**
 * Everything a themed surface needs, in one call.
 *
 * The high-contrast answer is a union for the same reason reduce-motion is:
 * Android's "high contrast text" is an accessibility setting a person set at
 * the OS level, and an app switch that is merely off must not override it. The
 * app's own switch can still ADD high contrast on a phone that does not ask for
 * it — the two directions are symmetric, which is the rule this iteration is
 * built on.
 */
export function useAppearanceA11y(): AppearanceA11y {
  const { colorScheme } = useColorScheme();
  const userHighContrast = useAppearanceA11yStore((s) => s.highContrast);
  const systemHighContrast = useSystemMotionStore((s) => s.highContrast);
  const highContrast = userHighContrast || systemHighContrast === true;
  const reduceMotion = useReducedMotion();
  return {
    theme: applyHighContrast(THEME[colorScheme], colorScheme, highContrast),
    highContrast,
    reduceMotion,
  };
}
