/**
 * List / Board / Table / Gantt / Swimlane view-mode toggle for the issue
 * workbench — mobile surface of web's `ViewBar` mode switch
 * (`packages/views/issues/components/view-bar.tsx`). All five of web's
 * `ViewMode` values are now reachable: iter-118 added gantt, iter-122 the
 * swimlane (its cross-lane move is a long-press menu rather than web's
 * drag-and-drop; see `swimlane-view.tsx`).
 *
 * Sits beneath the scope and filter row. Switching the view never clears
 * filters or sort (same store, same query window).
 *
 * Glyphs: Ionicons `list` / `grid` for list / board, MaterialCommunityIcons
 * `table` / `chart-gantt` / `view-column-outline` for table / gantt /
 * swimlane (Ionicons has none of those three).
 */
import { Pressable, useWindowDimensions, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { IssueViewMode } from "@/data/stores/issue-filter-slice";
import { useFontScale } from "@/data/stores/type-appearance-store";
import { issueViewModeColumns } from "@/lib/issue-view-mode-layout";
import { Text } from "@/components/ui/text";
import { useTranslation } from "@/lib/i18n/react";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

const OPTIONS: {
  value: IssueViewMode;
  a11yKey: string;
  labelKey: string;
}[] = [
  { value: "list", a11yKey: "a11y.viewList", labelKey: "issues.viewList" },
  { value: "board", a11yKey: "a11y.viewBoard", labelKey: "issues.viewBoard" },
  { value: "table", a11yKey: "a11y.viewTable", labelKey: "issues.viewTable" },
  { value: "gantt", a11yKey: "a11y.viewGantt", labelKey: "issues.viewGantt" },
  { value: "swimlane", a11yKey: "a11y.viewSwimlane", labelKey: "issues.viewSwimlane" },
];

function ModeGlyph({ value, color }: { value: IssueViewMode; color: string }) {
  switch (value) {
    case "board":
      return <Ionicons name="grid" size={15} color={color} />;
    case "table":
      return <MaterialCommunityIcons name="table" size={16} color={color} />;
    case "gantt":
      return <MaterialCommunityIcons name="chart-gantt" size={16} color={color} />;
    case "swimlane":
      return (
        <MaterialCommunityIcons
          name="view-column-outline"
          size={16}
          color={color}
        />
      );
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
  const { t } = useTranslation();
  const palette = useThemePalette();
  const { width, fontScale } = useWindowDimensions();
  const appFontScale = useFontScale();
  const columns = issueViewModeColumns(width, fontScale * (appFontScale ?? 1));
  return (
    <View
      className="flex-row flex-wrap items-stretch rounded-xl bg-secondary/70 p-1"
      accessibilityRole="tablist"
    >
      {OPTIONS.map((opt) => {
        const active = view === opt.value;
        const color = active
          ? palette.foreground
          : palette.mutedForeground;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`min-h-12 min-w-0 grow items-center justify-center gap-0.5 rounded-lg px-0.5 py-1 active:bg-surface-2 ${active ? "bg-background" : ""}`}
            style={{ flexBasis: `${100 / columns}%` }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(opt.a11yKey)}
          >
            <ModeGlyph value={opt.value} color={color} />
            <Text
              className={active ? "text-center text-micro font-semibold text-foreground" : "text-center text-micro text-muted-foreground"}
            >
              {t(opt.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}