/**
 * Pure picker body for issue status — catalog-driven (MUL-6243), grouped by
 * the 7 categories with every ACTIVE status per category (built-ins + custom
 * rows with their color dot). No shell, no modal — the caller (a formSheet
 * route screen, or any embedding surface) renders it inside whatever
 * container it needs.
 *
 * Split from the old `status-picker-sheet.tsx` so the same row UI can serve
 * both the issue-detail route (`issue/[id]/picker/status.tsx`, which writes
 * via useUpdateIssue) and the new-issue draft route
 * (`new-issue-picker/status.tsx`, which writes via useNewIssueDraftStore).
 *
 * Group headings only render when a category holds more than one status —
 * a workspace with no custom statuses renders exactly the old 7 flat rows.
 */
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import type { IssueStatus } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { useStatusOptions } from "@/lib/status-options";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  /** Currently selected status. `null` means "mixed selection" for batch
   *  pickers — no row is checked, and picking one applies it to the batch. */
  value: IssueStatus | null;
  onChange: (next: IssueStatus) => void;
}

export function StatusPickerBody({ value, onChange }: Props) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const { groups, hasCustom } = useStatusOptions();
  const checkColor =
    colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View className="px-4 pt-3 pb-2">
        <Text className="text-lg font-semibold text-foreground">{t("picker.status")}</Text>
      </View>
      <View className="px-2">
        {groups.map((group) => {
          const heading = hasCustom && group.options.length > 1;
          return (
            <View key={group.category}>
              {heading ? (
                <View className="px-3 pt-2 pb-1">
                  <Text className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                    {t(`enum.status.${group.category}`)}
                  </Text>
                </View>
              ) : null}
              {group.options.map((option) => {
                const selected = value !== null && option.key === value;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => onChange(option.key)}
                    className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-secondary"
                  >
                    <StatusIcon
                      status={option.key}
                      category={option.category}
                      color={option.color ?? undefined}
                      size={18}
                    />
                    <Text className="flex-1 text-base text-foreground">
                      {option.label}
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark" size={20} color={checkColor} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}