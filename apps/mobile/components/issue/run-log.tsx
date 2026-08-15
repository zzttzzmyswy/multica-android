/**
 * Execution log panel for a single task — rendered inside a past run's
 * expanded row in the Runs sheet (`components/issue/run-row.tsx`). Reads the
 * task's message stream (`GET /api/tasks/:id/messages`) and lays it out as:
 *
 *   - the agent's own `text` narration (rendered as markdown, matching
 *     comment bodies), then
 *   - the process steps (thinking / tool_use / tool_result / error) via the
 *     shared `ChatTimeline` fold.
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
import { partitionTaskLog } from "@/lib/task-log";
import { useTranslation } from "@/lib/i18n/react";

export function RunLog({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const { data = [], isLoading, isError, refetch } = useQuery(
    taskMessagesOptions(taskId),
  );

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
    return <Text className="py-2 text-xs text-muted-foreground">{t("runs.noLogs")}</Text>;
  }

  return (
    <View className="ml-9 mt-1 rounded-lg border border-border bg-muted/20 px-2 py-2 gap-2">
      {textFragments.map((text, i) => (
        <Markdown key={i} content={text} />
      ))}
      <ChatTimeline items={processSteps} />
    </View>
  );
}