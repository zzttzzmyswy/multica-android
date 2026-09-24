/**
 * Pure picker body for a sub-issue's stage — single-select over
 * "no stage" plus the derived stage numbers. See status-picker-body.tsx for
 * the pure-body split rationale.
 *
 * The option list comes from `stageOptions`, so the sheet can always reach
 * every stage already in use among the siblings plus one new one — a fixed
 * 1..5 list would silently strand a family that grew past it.
 */
import { Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import { stageOptions } from "@/lib/issue-stage";

interface Props {
  /** Current stage; null means unstaged. */
  value: number | null;
  /** Highest stage in use among siblings, so the list can extend past it. */
  maxStage?: number;
  onChange: (next: number | null) => void;
}

export function StagePickerBody({ value, maxStage = 0, onChange }: Props) {
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const checkColor =
    colorScheme === "dark" ? THEME.dark.primary : THEME.light.primary;
  const dim = colorScheme === "dark"
    ? THEME.dark.mutedForeground
    : THEME.light.mutedForeground;

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View className="px-4 pt-3 pb-2">
        <Text className="text-lg font-semibold text-foreground">
          {t("stage.title")}
        </Text>
      </View>
      <View className="px-2">
        {/* "No stage" first, matching every other picker (web puts the empty
            value at the top of the list). */}
        <Pressable
          onPress={() => onChange(null)}
          className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-secondary"
        >
          <Ionicons
            name="flag-outline"
            size={16}
            color={dim}
          />
          <Text className="flex-1 text-base text-muted-foreground">
            {t("stage.none")}
          </Text>
          {value == null ? (
            <Ionicons name="checkmark" size={20} color={checkColor} />
          ) : null}
        </Pressable>
        {stageOptions(value, maxStage).map((stage) => (
          <Pressable
            key={stage}
            onPress={() => onChange(stage)}
            className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-secondary"
          >
            <Ionicons
              name="flag-outline"
              size={16}
              color={dim}
            />
            <Text className="flex-1 text-base text-foreground">
              {t("stage.value", { n: stage })}
            </Text>
            {value === stage ? (
              <Ionicons name="checkmark" size={20} color={checkColor} />
            ) : null}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
