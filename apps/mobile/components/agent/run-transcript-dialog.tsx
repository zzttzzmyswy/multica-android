/**
 * Execution-transcript modal for a single agent task — the mobile port of
 * web's transcript entry (`TranscriptButton` → `AgentTranscriptDialog`,
 * `packages/views/common/task-transcript/`). Reads the task's message stream
 * through the same `taskMessagesOptions` query the Runs sheet uses, so
 * loading / error / empty and live-polling states behave exactly like the
 * issue Runs sheet, then adds web's reading controls: a type filter whose chips
 * are derived from the entries actually present, a sort-direction toggle, and a
 * per-entry copy action.
 *
 * `live` mirrors the row's running state (`isLive={isRunning}` on web): while
 * the task is running the log polls so the trace keeps growing on screen.
 */
import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AgentTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { TranscriptEntryRow } from "@/components/agent/transcript-entry";
import { taskMessagesOptions } from "@/data/queries/chat";
import { liveLogPollMs } from "@/lib/task-log-live";
import {
  deriveTranscriptFilterOptions,
  filterTranscriptEntries,
  resolveActiveFilterKeys,
  sortTranscriptEntries,
  type TranscriptSortDirection,
} from "@/lib/task-transcript";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function RunTranscriptDialog({
  taskId,
  taskStatus,
  onClose,
}: {
  taskId: string;
  taskStatus: AgentTask["status"];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const live = taskStatus === "running";

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [sortDirection, setSortDirection] = useState<TranscriptSortDirection>("oldest_first");

  const { data = [], isLoading, isError, refetch } = useQuery({
    ...taskMessagesOptions(taskId),
    refetchInterval: liveLogPollMs(live),
  });

  // Chips come from the entries present, so a run never offers a facet it has
  // no events for (web derives `filterOptions` the same way).
  const filterOptions = useMemo(() => deriveTranscriptFilterOptions(data), [data]);
  // A selected key the current transcript lacks is a no-op, not an empty list
  // (web resolves its persisted selection against the derived options).
  const activeKeys = useMemo(
    () => resolveActiveFilterKeys(selectedKeys, filterOptions),
    [selectedKeys, filterOptions],
  );
  const filteredEntries = useMemo(
    () => filterTranscriptEntries(data, activeKeys),
    [data, activeKeys],
  );
  const displayEntries = useMemo(
    () => sortTranscriptEntries(filteredEntries, sortDirection),
    [filteredEntries, sortDirection],
  );

  const toggleFilterKey = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const sortLabel =
    sortDirection === "oldest_first"
      ? t("runs.transcript.sortOldest")
      : t("runs.transcript.sortNewest");

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="border-b border-border px-4 py-3 flex-row items-center gap-3">
          <View className="size-8 rounded-lg bg-secondary items-center justify-center">
            <Ionicons
              name="document-text-outline"
              size={16}
              color={theme.mutedForeground}
            />
          </View>
          <Text className="flex-1 text-base font-semibold text-foreground">
            {t("agents.activity.transcriptTitle")}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("a11y.close")}
            hitSlop={8}
          >
            <Ionicons name="close" size={20} color={theme.mutedForeground} />
          </Pressable>
        </View>

        {filterOptions.length > 0 ? (
          <View className="border-b border-border flex-row items-center gap-2 py-2">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="flex-1"
              contentContainerClassName="gap-1.5 items-center px-4"
              accessibilityLabel={t("runs.transcript.filterLabel")}
            >
              <FilterChip
                label={t("runs.transcript.filterAll")}
                active={activeKeys.length === 0}
                onPress={() => setSelectedKeys([])}
              />
              {filterOptions.map((option) => (
                <FilterChip
                  key={option.key}
                  label={option.label}
                  active={activeKeys.includes(option.key)}
                  onPress={() => toggleFilterKey(option.key)}
                />
              ))}
            </ScrollView>
            {data.length > 1 ? (
              <Pressable
                onPress={() =>
                  setSortDirection((prev) =>
                    prev === "oldest_first" ? "newest_first" : "oldest_first",
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={sortLabel}
                className="mr-4 shrink-0 flex-row items-center gap-1 rounded-full border border-border px-2.5 py-1 active:opacity-70"
              >
                <Ionicons
                  name={sortDirection === "oldest_first" ? "arrow-down" : "arrow-up"}
                  size={12}
                  color={theme.mutedForeground}
                />
                <Text className="text-[11px] text-muted-foreground">{sortLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {isLoading ? (
          <View className="py-6 items-center">
            <ActivityIndicator />
          </View>
        ) : isError && data.length === 0 ? (
          <View className="px-4 py-3 items-start gap-2">
            <Text className="text-xs text-destructive">{t("runs.logLoadError")}</Text>
            <Pressable
              onPress={() => refetch()}
              accessibilityRole="button"
              className="px-2 py-1 rounded-md bg-secondary active:opacity-70"
            >
              <Text className="text-xs font-medium text-foreground">{t("issue.retry")}</Text>
            </Pressable>
          </View>
        ) : data.length === 0 ? (
          <View className="px-4 py-3">
            <Text className="text-xs text-muted-foreground">{t("runs.noLogsYet")}</Text>
          </View>
        ) : displayEntries.length === 0 ? (
          <View className="px-4 py-6 items-center">
            <Text className="text-xs text-muted-foreground">
              {t("runs.transcript.filterEmpty")}
            </Text>
          </View>
        ) : (
          <ScrollView className="flex-1" contentContainerClassName="pb-4">
            {displayEntries.map((entry) => (
              <TranscriptEntryRow key={`${entry.task_id}-${entry.seq}`} entry={entry} />
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/** One derived filter chip — an "all" chip or a `tool:<Name>` / type facet. */
function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={cn(
        "rounded-full border px-2.5 py-1",
        active ? "border-primary bg-primary/10" : "border-border bg-secondary/50",
      )}
    >
      <Text
        className={cn(
          "text-[11px]",
          active ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
