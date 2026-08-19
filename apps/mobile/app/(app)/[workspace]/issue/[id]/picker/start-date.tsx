/**
 * Start-date picker route for an existing issue.
 *
 * Existing-issue counterpart of `new-issue-picker/start-date.tsx` — the
 * same `DueDatePickerBody` spinner + Done / Clear header, writing
 * `issue.start_date` instead of a draft. start_date is a calendar day in
 * the same "YYYY-MM-DD" convention as due_date (see
 * @multica/core/issues/date), so the picker body is shared as-is. Mirrors
 * web's optional-property `start_date` edit affordance
 * (packages/views/issues/components/issue-detail.tsx `OPTIONAL_PROP_KEYS`).
 */
import { useRef } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import {
  DueDatePickerBody,
  type DueDatePickerBodyHandle,
} from "@/components/issue/pickers/due-date-picker-body";
import { issueDetailOptions } from "@/data/queries/issues";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueStartDatePickerRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const updateIssue = useUpdateIssue(id);
  const ref = useRef<DueDatePickerBodyHandle>(null);

  const value = issue?.start_date ?? null;

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
        <Text className="text-base font-semibold text-foreground">
          {t("startDate.title")}
        </Text>
        <View className="flex-row items-center gap-1">
          {value ? (
            <Pressable
              onPress={() => {
                updateIssue.mutate({ start_date: null });
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
              if (iso) updateIssue.mutate({ start_date: iso });
              router.back();
            }}
            hitSlop={6}
            className="px-2 py-1 rounded-md active:bg-secondary"
          >
            <Text className="text-sm font-medium text-primary">{t("common.done")}</Text>
          </Pressable>
        </View>
      </View>
      <DueDatePickerBody ref={ref} value={value} />
    </View>
  );
}