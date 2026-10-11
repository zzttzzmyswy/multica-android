/**
 * Batch-action bar for the autopilots list — the mobile port of web's
 * `AutopilotBatchToolbar` (`autopilot-list-actions.tsx:218-302`, MYS-2096).
 *
 * Web floats this at the page root with "N selected" + a clear-selection X,
 * then pause / resume / delete. Mobile renders the same three actions in the
 * same bar shape the skills and issues lists already use
 * (`SkillBatchBar`, `issue/batch-action-bar.tsx`), so the app's three
 * multi-select surfaces behave alike.
 *
 * The pause/resume pair is ADAPTIVE, exactly as web's is (`:236-244`): each
 * button appears when ANY selected row sits in the opposite status, so a mixed
 * selection offers both rather than guessing at a majority. That rule lives in
 * the tested `autopilotBatchActions`, not here.
 *
 * Differences that come from the platform, not from a change of intent:
 *   - The bar is anchored to the bottom safe area rather than absolutely
 *     centred (`bottom-6 left-1/2`), which is where the app's other batch bars
 *     sit and where a thumb reaches.
 *   - "N selected" is `actions.selected`, web's `_other` wording: the toolbar
 *     renders only for a non-empty selection, and this app's `translate` does
 *     not resolve plural suffixes.
 */
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Autopilot } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { autopilotBatchActions } from "@/lib/autopilot-list-actions";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function AutopilotBatchBar({
  /** The selection, already intersected with the rows the list shows now. */
  rows: selectedRows,
  /** Whether every currently-visible row is selected — drives the select-all
   *  control's label and glyph. Computed by the screen, which owns both sets. */
  allVisibleSelected,
  onToggleSelectAll,
  onExit,
  onStatusChange,
  onDelete,
}: {
  rows: readonly Autopilot[];
  allVisibleSelected: boolean;
  onToggleSelectAll: () => void;
  /** Leave selection mode (the bar's "Done"). */
  onExit: () => void;
  onStatusChange: (status: "active" | "paused") => void;
  /** Open the shared delete confirm for the whole selection. */
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const count = selectedRows.length;
  const actions = autopilotBatchActions(selectedRows);

  // The bar renders only for a live selection; the parent may keep it mounted
  // through a refetch that empties it.
  if (count === 0) return null;

  return (
    <View
      className="absolute inset-x-0 bg-background border-t border-border"
      style={{ bottom: insets.bottom, paddingBottom: insets.bottom }}
    >
      <View className="px-4 py-2">
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={onExit}
            className="flex-row items-center gap-1.5 py-1"
            accessibilityLabel={t("autopilots.list.exitSelection")}
          >
            <Ionicons name="close" size={18} color="currentColor" />
            <Text className="text-body font-medium text-foreground">
              {t("autopilots.actions.selected", { count })}
            </Text>
          </Pressable>
          <Pressable
            onPress={onToggleSelectAll}
            className="flex-row items-center gap-1 py-1 px-1"
            accessibilityLabel={
              allVisibleSelected
                ? t("autopilots.actions.clear_selection")
                : t("batch.selectAll")
            }
          >
            <Ionicons
              name={allVisibleSelected ? "checkmark-done-outline" : "checkbox-outline"}
              size={16}
              color="currentColor"
            />
            <Text className="text-body text-muted-foreground">
              {allVisibleSelected
                ? t("autopilots.actions.clear_selection")
                : t("batch.selectAll")}
            </Text>
          </Pressable>
        </View>
        {/* Every action on one row: web's three-item bar, and the only
            selection state a phone bar has room for. Delete leads the row's
            destructive colouring. */}
        <View className="flex-row gap-1 pt-1 pb-1">
          {actions.pause ? (
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-center"
              onPress={() => onStatusChange("paused")}
            >
              <Ionicons name="pause" size={16} />
              <Text numberOfLines={1}>{t("autopilots.actions.pause")}</Text>
            </Button>
          ) : null}
          {actions.resume ? (
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-center"
              onPress={() => onStatusChange("active")}
            >
              <Ionicons name="play" size={16} />
              <Text numberOfLines={1}>{t("autopilots.actions.resume")}</Text>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-center"
            onPress={onDelete}
          >
            <Ionicons name="trash-outline" size={16} color={theme.destructive} />
            <Text className="text-destructive" numberOfLines={1}>
              {t("autopilots.actions.delete")}
            </Text>
          </Button>
        </View>
      </View>
    </View>
  );
}
