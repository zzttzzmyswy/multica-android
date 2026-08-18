/**
 * List / Board view-mode toggle for the issue workbench — mobile surface of
 * web's `ViewBar` mode switch (`packages/views/issues/components/view-bar.tsx`),
 * restricted to the two phone-appropriate modes.
 *
 * Sits right of the scope pills on both issue-list screens, next to the
 * filter trigger. Reads/writes the `view` field on the screen's view store;
 * switching never clears filters or sort (same store, same query window).
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { IssueViewMode } from "@/data/stores/issue-filter-slice";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

const OPTIONS: { value: IssueViewMode; icon: "list" | "grid"; a11yKey: string }[] = [
  { value: "list", icon: "list", a11yKey: "a11y.viewList" },
  { value: "board", icon: "grid", a11yKey: "a11y.viewBoard" },
];

export function ViewModeToggle({
  view,
  onChange,
}: {
  view: IssueViewMode;
  onChange: (view: IssueViewMode) => void;
}) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center rounded-lg border border-border bg-secondary/40 p-0.5"
      accessibilityRole="tablist"
    >
      {OPTIONS.map((opt) => {
        const active = view === opt.value;
        const color = active
          ? THEME[colorScheme].foreground
          : THEME[colorScheme].mutedForeground;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`rounded-md px-2 py-1 ${active ? "bg-accent" : ""}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(opt.a11yKey)}
          >
            <Ionicons name={opt.icon} size={15} color={color} />
          </Pressable>
        );
      })}
    </View>
  );
}