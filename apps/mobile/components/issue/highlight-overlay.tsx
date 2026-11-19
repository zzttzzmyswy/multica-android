/**
 * The animated "this is the thing you asked for" flash.
 *
 * One implementation for the three surfaces that flash: a root comment bubble,
 * a reply row, and a header block (the title / the description, when an
 * in-page find step lands there). They differ only in chrome — the root and a
 * header block get a brand border around a faint wash, a reply gets the wash
 * alone — so the timing and the animation mechanism live here once.
 *
 * Why opacity and not the colours: animating `borderWidth` would push children
 * on every frame, so the border width stays constant and only `opacity` moves.
 * The colours therefore arrive as `className` (NativeWind tokens, which cannot
 * be driven from `useAnimatedStyle`) and only the opacity is a shared value.
 *
 * Timing — 700ms fade-in → 1800ms hold → 700ms fade-out — matches web's
 * `transition-colors duration-700` + `setTimeout(2500)`.
 *
 * `pointerEvents="none"` is load-bearing: the overlay sits on top of the
 * content it highlights, and the reader must still be able to long-press a
 * comment, tap a chip, or scroll through it.
 */
import { useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { motionDuration, useReducedMotion } from "@/lib/appearance-a11y-runtime";

export function HighlightOverlay({
  active,
  className,
  style,
}: {
  active: boolean;
  /** The chrome. Callers pass the brand border / wash combination their
   *  surface uses; this component owns only the animation. */
  className: string;
  /** Extra layout, e.g. the rounded corners a card-shaped surface needs. */
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    // Reduced motion (MYS-2950): keep the flash, drop the fade. A zero-length
    // `withTiming` still runs its completion, so the sequence settles at 0 the
    // same way it does with the fades — the reader still sees WHERE the find
    // landed (the overlay is on screen for the whole hold), they just do not
    // get a 700ms fade in and out. The hold is kept at full length on purpose:
    // removing the fade must not also shorten how long the highlight is there,
    // which is the part carrying the information.
    progress.value = withSequence(
      withTiming(1, { duration: motionDuration(700, reduceMotion) }),
      withDelay(
        motionDuration(1800, reduceMotion),
        withTiming(0, { duration: motionDuration(700, reduceMotion) }),
      ),
    );
  }, [active, progress, reduceMotion]);

  const animated = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Animated.View
      pointerEvents="none"
      className={className}
      style={[animated, style]}
    />
  );
}
