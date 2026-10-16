/**
 * "Some workspace data failed to load" banner for the skills surfaces — the
 * phone's rendering of web's `role="status"` strip
 * (`packages/views/skills/components/skills-page.tsx:802-810`,
 * `skill-detail-page.tsx:1236-1246`).
 *
 * Why the banner is the whole fix on a phone rather than a nicety: web shows
 * the same cells (an 「unused」 label, a lock that falls back to creator-only)
 * under the same failure, but a desktop user can hover the lock and read the
 * tooltip. Mobile moved that tooltip into an `accessibilityLabel`, so a sighted
 * user gets a bare glyph and nothing else. Without this banner the screen has
 * no channel at all through which the failure can be named.
 *
 * The two surfaces word it differently — the list says attribution / runtime
 * names / edit rights "may appear incomplete", the detail page adds "until the
 * next refresh" — so the copy is the caller's, exactly as web splits
 * `page.supporting_data_warning` from `detail.supporting_data_warning`.
 *
 * Deliberately pre-rendered rather than a hook: `catalogRead` has already
 * resolved the states, and a banner that re-derived them could disagree with
 * the rows it is explaining.
 */
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function SupportingDataWarning({
  /** Already-resolved copy — the caller's `t(...)`. */
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  return (
    <View
      // Web marks this strip `role="status"` so a screen reader announces it
      // without stealing focus; the RN equivalent is a polite live region, the
      // same pairing `components/issue/create-run-hint.tsx` uses.
      accessibilityLiveRegion="polite"
      className={cn(
        "flex-row items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2",
        className,
      )}
    >
      <Ionicons
        name="warning-outline"
        size={14}
        color={theme.warning}
        style={{ marginTop: 1 }}
      />
      <Text className="flex-1 text-caption text-muted-foreground">{message}</Text>
    </View>
  );
}
