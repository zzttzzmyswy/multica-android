/**
 * Chat 任务队列卡 —— 贴 composer 上沿，展示排队中的任务（web
 * `packages/views/chat/components/chat-queue.tsx` 的移动端镜像）。
 *
 * 每个排队任务一行：内容（截断）+ 立即发送（Steer，仅 head 处于
 * dispatched / running / waiting_local_directory 时可用）+ 编辑 + 移除；
 * 卡片标题行提供「全部清空」。操作在 busy 期间全部禁用，失败弹
 * Alert（web 的 action_failed_toast 等价物）。
 *
 * web 的「更多菜单」里才有清空入口；移动端把它提到标题行 —— 触屏
 * 上外露比藏进三步菜单更符合单手操作。
 */
import { useState } from "react";
import { Alert, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ChatPendingTask, ChatQueuedTask } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { IconButton } from "@/components/ui/icon-button";
import { useTranslation } from "@/lib/i18n/react";
import { canSteer, queueEditDraftText, queueRows } from "@/lib/chat-queue";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

interface Props {
  pendingTask: ChatPendingTask | null | undefined;
  onSendNow: (task: ChatQueuedTask) => Promise<void>;
  onEdit: (task: ChatQueuedTask) => Promise<void>;
  onRemove: (task: ChatQueuedTask) => Promise<void>;
  onClear: () => Promise<void>;
}

export function ChatQueue({
  pendingTask,
  onSendNow,
  onEdit,
  onRemove,
  onClear,
}: Props) {
  const { t } = useTranslation();
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? THEME.dark : THEME.light;
  const mutedColor = theme.mutedForeground;
  const tasks = queueRows(pendingTask);
  const steerable = canSteer(pendingTask);
  const [busy, setBusy] = useState<string | null>(null);

  if (tasks.length === 0) return null;

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
    } catch {
      Alert.alert(t("chat.queue.actionFailed"));
    } finally {
      setBusy((current) => (current === key ? null : current));
    }
  };

  return (
    // Rounded top corners only — the bottom edge tucks behind the next card
    // (the composer), so a full radius looks detached. Same "emerges from
    // behind the input" reading as web's -mb-3 queue tuck.
    <View className="mx-3 mb-[-6] rounded-t-lg border border-b-0 border-border bg-card px-3 pt-2 pb-3">
      <View className="mb-1.5 flex-row items-center gap-1.5">
        <Ionicons name="albums-outline" size={14} color={mutedColor} />
        <Text className="flex-1 text-xs font-medium text-muted-foreground">
          {t("chat.queue.title", { count: tasks.length })}
        </Text>
        <IconButton
          name="close"
          iconSize={13}
          disabled={busy !== null}
          accessibilityLabel={t("chat.queue.clear")}
          onPress={() => void run("clear", onClear)}
        />
      </View>
      {tasks.map((task) => {
        const rowText = queueEditDraftText(task) ?? t("chat.queue.fallback");
        return (
          <View
            key={task.task_id}
            className="min-h-8 flex-row items-center gap-1"
          >
            <Ionicons name="arrow-redo-outline" size={13} color={mutedColor} />
            <Text
              numberOfLines={1}
              className="min-w-0 flex-1 text-sm text-muted-foreground"
            >
              {rowText}
            </Text>
            <IconButton
              name="play"
              iconSize={13}
              disabled={busy !== null || !steerable}
              accessibilityLabel={t("chat.queue.steer")}
              onPress={() =>
                void run(`send:${task.task_id}`, () => onSendNow(task))
              }
            />
            <IconButton
              name="create-outline"
              iconSize={13}
              disabled={busy !== null}
              accessibilityLabel={t("chat.queue.edit")}
              onPress={() =>
                void run(`edit:${task.task_id}`, () => onEdit(task))
              }
            />
            <IconButton
              name="trash-bin-outline"
              iconSize={13}
              disabled={busy !== null}
              accessibilityLabel={t("chat.queue.remove")}
              onPress={() =>
                void run(`remove:${task.task_id}`, () => onRemove(task))
              }
            />
          </View>
        );
      })}
    </View>
  );
}