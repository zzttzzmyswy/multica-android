/**
 * List / Board / Table / Gantt view-mode toggle for the issue workbench —
 * mobile surface of web's `ViewBar` mode switch
 * (`packages/views/issues/components/view-bar.tsx`); iter-118 adds gantt
 * (swimlane stays phone-deferred: drag-to-reorder across lanes).
 *
 * Sits right of the scope pills on all issue-list surfaces, next to the
 * filter trigger. Reads/writes the `view` field on the screen's view store;
 * switching never clears filters or sort (same store, same query window).
 *
 * Glyphs: Ionicons `list` / `grid` for list / board, MaterialCommunityIcons
 * `table` / `chart-gantt` for the table / gantt modes (Ionicons has neither).
 */
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { IssueViewMode } from "@/data/stores/issue-filter-slice";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

const OPTIONS: {
  value: IssueViewMode;
  a11yKey: string;
}[] = [
  { value: "list", a11yKey: "a11y.viewList" },
  { value: "board", a11yKey: "a11y.viewBoard" },
  { value: "table", a11yKey: "a11y.viewTable" },
  { value: "gantt", a11yKey: "a11y.viewGantt" },
];

function ModeGlyph({ value, color }: { value: IssueViewMode; color: string }) {
  switch (value) {
    case "board":
      return <Ionicons name="grid" size={15} color={color} />;
    case "table":
      return <MaterialCommunityIcons name="table" size={16} color={color} />;
    case "gantt":
      return <MaterialCommunityIcons name="chart-gantt" size={16} color={color} />;
    case "list":
    default:
      return <Ionicons name="list" size={15} color={color} />;
  }
}

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
            <ModeGlyph value={opt.value} color={color} />
          </Pressable>
        );
      })}
    </View>
  );
}