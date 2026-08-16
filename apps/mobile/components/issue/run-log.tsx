/**
 * Execution log panel for a single task — rendered inside an expanded row in
 * the Runs sheet (`components/issue/run-row.tsx`). Reads the task's message
 * stream (`GET /api/tasks/:id/messages`) and lays it out as:
 *
 *   - the agent's own `text` narration (rendered as markdown, matching
 *     comment bodies), then
 *   - the process steps (thinking / tool_use / tool_result / error) via the
 *     shared `ChatTimeline` fold.
 *
 * `live` renders a running task's still-growing trace: the query polls on a
 * short interval so progress shows up even if a WS event goes missing (the
 * chat layer fights the same half-open-socket gap with `chat-task-polling`).
 * The poll stops on its own — unmounting the live log is what ends it. Active
 * runs carry a small "live" badge so the reloading trace reads as intended
 * instead of a static snapshot.
 *
 * Loading / error / empty states are handled here so the caller only has to
 * decide *whether* to expand.
 */
import { ActivityIndicator, Pressable, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { ChatTimeline } from "@/components/chat/chat-timeline";
import { Markdown } from "@/lib/markdown";
import { taskMessagesOptions } from "@/data/queries/chat";
import { liveLogPollMs } from "@/lib/task-log-live";
import { partitionTaskLog } from "@/lib/task-log";
import { useTranslation } from "@/lib/i18n/react";

export function RunLog({ taskId, live = false }: { taskId: string; live?: boolean }) {
  const { t } = useTranslation();
  const { data = [], isLoading, isError, refetch } = useQuery({
    ...taskMessagesOptions(taskId),
    refetchInterval: liveLogPollMs(live),
  });

  if (isLoading) {
    return (
      <View className="py-3 items-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="py-2 items-start gap-2">
        <Text className="text-xs text-destructive">{t("runs.logLoadError")}</Text>
        <Pressable
          onPress={() => refetch()}
          accessibilityRole="button"
          className="px-2 py-1 rounded-md bg-secondary active:opacity-70"
        >
          <Text className="text-xs font-medium text-foreground">{t("issue.retry")}</Text>
        </Pressable>
      </View>
    );
  }

  const { processSteps, textFragments } = partitionTaskLog(data);
  const hasContent = processSteps.length > 0 || textFragments.length > 0;
  if (!hasContent) {
    return (
      <View className="ml-9 mt-1 gap-1">
        {live ? <LiveBadge label={t("runs.liveLog")} /> : null}
        <Text className="py-1 text-xs text-muted-foreground">{t("runs.noLogsYet")}</Text>
      </View>
    );
  }

  return (
    <View className="ml-9 mt-1 rounded-lg border border-border bg-muted/20 px-2 py-2 gap-2">
      {live ? <LiveBadge label={t("runs.liveLog")} /> : null}
      {textFragments.map((text, i) => (
        <Markdown key={i} content={text} />
      ))}
      <ChatTimeline items={processSteps} />
    </View>
  );
}

function LiveBadge({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-1.5 self-start rounded-full bg-brand/10 px-2 py-0.5">
      <View className="size-1.5 rounded-full bg-brand" />
      <Text className="text-[11px] font-medium text-brand">{label}</Text>
    </View>
  );
}