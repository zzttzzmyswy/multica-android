/**
 * The drag target that resizes one table column. Extracted from the issue
 * table (iteration 134) so the projects compact table (iteration 135) shares
 * one gesture implementation instead of a second, subtly different one — the
 * responder negotiation below is the part that took the iteration to get
 * right, and a copy would rot independently.
 *
 * Owns its own PanResponder: the gesture starts from whatever the column's
 * width was when the finger landed (captured in a ref, so a re-render mid-drag
 * cannot shift the origin) and reports the running delta outward.
 *
 * Responder negotiation matters here — the handle sits inside the header's
 * horizontal ScrollView, and a plain Pressable would lose the drag to the
 * scroller. Claiming the responder on touch-down (before any movement, which
 * is when a ScrollView normally takes over) keeps the horizontal drag for the
 * resize; `onMoveShouldSetPanResponderCapture` is the belt-and-braces path for
 * a drag that begins before the responder grant lands.
 */
import { useMemo, useRef, useState } from "react";
import { PanResponder, View } from "react-native";
import { COLUMN_WIDTH_MAX, COLUMN_WIDTH_MIN } from "@/data/stores/issue-table-columns";

export function ColumnResizeHandle({
  label,
  startWidth,
  height,
  width = 22,
  onStart,
  onMove,
  onCommit,
}: {
  label: string;
  /** The column's current width — the origin a new drag measures from. */
  startWidth: number;
  /** Header height, so the handle fills the cell it sits in. */
  height: number;
  width?: number;
  onStart: () => void;
  onMove: (startWidth: number, dx: number) => void;
  onCommit: (startWidth: number, dx: number) => void;
}) {
  const [active, setActive] = useState(false);
  /**
   * The width the NEXT drag would start from — refreshed on every render so
   * the grant handler below reads the column's *current* width rather than the
   * one it had at mount (otherwise the second drag on a column would snap it
   * back to the first drag's origin).
   */
  const latestWidth = useRef(startWidth);
  latestWidth.current = startWidth;
  /**
   * The width the drag IN PROGRESS started from, frozen at grant time.
   *
   * Deliberately a different ref from `latestWidth`. The parent feeds the
   * provisional width back down while the finger is moving (that is how the
   * live preview reaches the screen), so a start value re-read on every render
   * would already contain this drag's delta — and adding the cumulative `dx`
   * to it again each frame compounds the movement, so a short drag throws the
   * column to the far end of its range. Frozen at grant, `start + dx` is the
   * width the finger is actually pointing at.
   */
  const gestureStart = useRef(startWidth);
  // Latest callbacks, kept fresh for the same reason.
  const handlers = useRef({ onStart, onMove, onCommit });
  handlers.current = { onStart, onMove, onCommit };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim the touch on the way down and keep it: the header sits in a
        // horizontal ScrollView, and a handle that only asks for the
        // responder once the finger has already moved loses that race — the
        // scroller starts panning first. Asking on touch-down also means the
        // gesture never has to be re-negotiated mid-drag.
        //
        // Deliberately NOT using the `*Capture` variants: those run on the
        // way down from the root and returning true there blocks the other
        // responder candidates without granting the responder to this view,
        // which leaves the gesture owned by nobody and the handle dead.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          gestureStart.current = latestWidth.current;
          setActive(true);
          handlers.current.onStart();
        },
        onPanResponderMove: (_e, g) => {
          handlers.current.onMove(gestureStart.current, g.dx);
        },
        onPanResponderRelease: (_e, g) => {
          setActive(false);
          handlers.current.onCommit(gestureStart.current, g.dx);
        },
        onPanResponderTerminate: (_e, g) => {
          setActive(false);
          handlers.current.onCommit(gestureStart.current, g.dx);
        },
      }),
    [],
  );

  return (
    <View
      {...responder.panHandlers}
      style={{ width, height }}
      className="items-center justify-center"
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{
        min: COLUMN_WIDTH_MIN,
        max: COLUMN_WIDTH_MAX,
        now: Math.round(startWidth),
      }}
    >
      <View
        style={{ width: active ? 3 : 2 }}
        className={`h-4 rounded-full ${active ? "bg-primary" : "bg-border"}`}
      />
    </View>
  );
}
