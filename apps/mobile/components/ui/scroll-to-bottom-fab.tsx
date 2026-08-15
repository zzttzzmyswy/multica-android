/**
 * Floating "jump to bottom" button — a circular FAB anchored to the bottom-
 * right of whichever list it overlays (chat message list, issue timeline).
 *
 * It appears only while the user is scrolled up away from the list bottom
 * and hides as soon as they return to the bottom. The caller owns the
 * show/hide decision (derived from `isNearBottom`) and the scroll action;
 * this component is purely presentation.
 *
 * Reanimated entrance mirrors the fade/slide idiom used by toast-style
 * overlays elsewhere in the app (`NewCommentChip` uses a plain jump-cut;
 * we keep the arrow button slightly animated so appearing/disappearing
 * doesn't snap). Content is a single Ionicon glyph — no text — so no i18n
 * is needed for the visible label; the caller passes an accessibility
 * label so screen readers announce the intent in the current locale.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable } from "react-native";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props {
  /** Hide the button entirely when the user is at (or within slack of) the
   *  list bottom. When false the component renders nothing. */
  visible: boolean;
  /** Smoothly scroll the list to its end. */
  onPress: () => void;
  /** Screen-reader label for the button, e.g. t("a11y.jumpToBottom"). */
  accessibilityLabel: string;
  /** Distance from the container's bottom edge (px). Defaults to 16 —
   *  callers above a composer typically raise this so the FAB floats above
   *  the input bar. */
  bottom?: number;
  /** Distance from the container's right edge (px). Defaults to 16. */
  right?: number;
}

export function ScrollToBottomFAB({
  visible,
  onPress,
  accessibilityLabel,
  bottom = 16,
  right = 16,
}: Props) {
  const { colorScheme } = useColorScheme();
  const { primary, primaryForeground } = THEME[colorScheme];

  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeInDown.duration(150)}
      exiting={FadeOutUp.duration(120)}
      style={{
        position: "absolute",
        bottom,
        right,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.22,
        shadowRadius: 6,
        elevation: 6,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        className="size-12 items-center justify-center rounded-full active:opacity-80"
        style={{ backgroundColor: primary }}
      >
        <Ionicons name="arrow-down" size={22} color={primaryForeground} />
      </Pressable>
    </Animated.View>
  );
}