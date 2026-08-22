/**
 * Floating "jump to top / jump to bottom" control — two circular buttons
 * stacked vertically and anchored to the bottom-right of whichever list it
 * overlays (chat message list, issue timeline).
 *
 * Each button shows independently:
 *   - down (jump to bottom): while the user is scrolled up away from the
 *     list bottom — unchanged behavior from the single-button FAB;
 *   - up (jump to top): only while the user is in the middle band — neither
 *     at the top (where it would be pointless) nor at the bottom (where the
 *     "caught up" state stays clean).
 *
 * The caller owns both show/hide decisions (derived from the pure helpers in
 * `lib/scroll-bottom.ts`) and both scroll actions; this component is purely
 * presentation. Reanimated `entering` gives each button a quick fade in when
 * it appears; there is intentionally no `exiting` animation — the caller
 * flips the flag and we unmount the same frame, so an exit preset would have
 * nothing to play against (same jump-cut the single-button FAB used).
 * Buttons are icon-only, so no i18n is needed for visible labels; the caller
 * passes accessibility labels in the current locale.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View } from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props {
  /** Hide the up (jump to top) button. When false the button renders nothing
   *  (the control still shows the down button if that one is visible). */
  showJumpToTop: boolean;
  /** Hide the down (jump to bottom) button. When false the button renders
   *  nothing (the control still shows the up button if that one is). */
  showJumpToBottom: boolean;
  /** Smoothly scroll the list to its top (offset 0). */
  onJumpToTop: () => void;
  /** Smoothly scroll the list to its end. */
  onJumpToBottom: () => void;
  /** Screen-reader label for the up button, e.g. t("a11y.jumpToTop"). */
  jumpToTopLabel: string;
  /** Screen-reader label for the down button, e.g. t("a11y.jumpToBottom"). */
  jumpToBottomLabel: string;
  /** Distance from the container's bottom edge (px). Defaults to 16 —
   *  callers above a composer typically raise this so the control floats
   *  above the input bar. */
  bottom?: number;
  /** Distance from the container's right edge (px). Defaults to 16. */
  right?: number;
}

export function ScrollJumpControl({
  showJumpToTop,
  showJumpToBottom,
  onJumpToTop,
  onJumpToBottom,
  jumpToTopLabel,
  jumpToBottomLabel,
  bottom = 16,
  right = 16,
}: Props) {
  const { colorScheme } = useColorScheme();
  const { primary, primaryForeground } = THEME[colorScheme];

  if (!showJumpToTop && !showJumpToBottom) return null;

  return (
    <View
      style={{
        position: "absolute",
        bottom,
        right,
        gap: 8,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.22,
        shadowRadius: 6,
        elevation: 6,
      }}
    >
      {showJumpToTop ? (
        <Animated.View entering={FadeInUp.duration(150)}>
          <Pressable
            onPress={onJumpToTop}
            accessibilityRole="button"
            accessibilityLabel={jumpToTopLabel}
            className="size-12 items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: primary }}
          >
            <Ionicons name="arrow-up" size={22} color={primaryForeground} />
          </Pressable>
        </Animated.View>
      ) : null}
      {showJumpToBottom ? (
        <Animated.View entering={FadeInDown.duration(150)}>
          <Pressable
            onPress={onJumpToBottom}
            accessibilityRole="button"
            accessibilityLabel={jumpToBottomLabel}
            className="size-12 items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: primary }}
          >
            <Ionicons name="arrow-down" size={22} color={primaryForeground} />
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}