/**
 * Start-date picker route for the in-progress new-issue draft. Mirrors
 * `./due-date.tsx` exactly — same date-only spinner + Done / Clear header
 * — writing into the draft's `startDate` instead of `dueDate`. start_date
 * uses the same "YYYY-MM-DD" calendar-day convention as due_date (see
 * `@multica/core/issues/date`), so the picker body is shared as-is.
 */
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { Text } from "@/components/ui/text";
import {
  DueDatePickerBody,
  type DueDatePickerBodyHandle,
} from "@/components/issue/pickers/due-date-picker-body";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useTranslation } from "@/lib/i18n/react";

export default function NewIssueStartDatePickerRoute() {
  const { t } = useTranslation();
  const startDate = useNewIssueDraftStore((s) => s.startDate);
  const setStartDate = useNewIssueDraftStore((s) => s.setStartDate);
  const ref = useRef<DueDatePickerBodyHandle>(null);

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-base font-semibold text-foreground">
          {t("startDate.title")}
        </Text>
        <View className="flex-row items-center gap-1">
          {startDate ? (
            <Pressable
              onPress={() => {
                setStartDate(null);
                router.back();
              }}
              hitSlop={6}
              className="px-2 py-1 rounded-md active:bg-secondary"
            >
              <Text className="text-sm text-destructive">{t("common.clear")}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              const iso = ref.current?.getIso();
              if (iso) setStartDate(iso);
              router.back();
            }}
            hitSlop={6}
            className="px-2 py-1 rounded-md active:bg-secondary"
          >
            <Text className="text-sm font-medium text-primary">{t("common.done")}</Text>
          </Pressable>
        </View>
      </View>
      <DueDatePickerBody ref={ref} value={startDate} />
    </View>
  );
}