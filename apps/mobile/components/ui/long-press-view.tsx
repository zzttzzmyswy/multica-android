/**
 * Long-press → action trigger. Drops the scroll-blocking behavior of RN's
 * `Pressable` on Android.
 *
 * MYS-277: wide markdown tables (and code blocks) inside chat bubbles /
 * comment cards could not be swiped horizontally on Android. Root cause:
 * `Pressable`'s Pressability claims the touch responder, which steals
 * horizontal drags from ANY scrollable child — enriched-markdown's native
 * `HorizontalScrollView` (tables) and RN's own horizontal `ScrollView`
 * (code blocks). Evidence: the identical table scrolled on the issue
 * description (no Pressable ancestor), and scrolled again immediately when
 * the same card entered text-selection mode (Pressable unmounted).
 *
 * This wrapper drives long-press through react-native-gesture-handler's
 * native gesture arena instead. A child scroll view wins the gesture on
 * movement (a scroll cancels the long press); a still hold for
 * `delayLongPress` activates it — identical UX to `Pressable`, minus the
 * responder steal.
 */
import { Children, useMemo } from "react";
import type { ReactNode } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

interface Props {
  children: ReactNode;
  onLongPress: () => void;
  delayLongPress?: number;
}

export function LongPressView({
  children,
  onLongPress,
  delayLongPress = 500,
}: Props) {
  const gesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(delayLongPress)
        .runOnJS(true)
        .onStart(onLongPress),
    [onLongPress, delayLongPress],
  );

  return (
    <GestureDetector gesture={gesture}>
      {Children.only(children)}
    </GestureDetector>
  );
}