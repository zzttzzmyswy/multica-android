/**
 * Download manager (MYS-336) — reached from More → Downloads.
 *
 * Two segmented tabs over the persisted download history:
 *
 *  - 进行中: in-flight tasks with progress bar + percentage + cancel.
 *  - 已完成: terminal rows (completed / failed / cancelled) with filename,
 *    source, completion time; completed rows open the system handler sheet,
 *    failed rows offer retry (with the recorded reason), all rows can be
 *    deleted (which also removes the cached file), plus a clear-all action.
 *
 * State lives entirely in `useDownloadsStore` (zustand + file persistence);
 * this screen only renders it. Hydrate on entry so history from a previous
 * session is restored.
 */
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useEffect, useMemo, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Sharing from "expo-sharing";
import { Text } from "@/components/ui/text";
import { useDownloadsStore } from "@/data/downloads-store";
import { mimeTypeForFilename } from "@/lib/attachment-download";
import {
  downloadSourceLabelKey,
  downloadSourceName,
  isTerminalStatus,
  type DownloadTask,
} from "@/lib/download-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { getCurrentLocale } from "@/lib/i18n";
import { useTranslation } from "@/lib/i18n/react";

type Tab = "active" | "finished";

export default function DownloadsPage() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const tasks = useDownloadsStore((s) => s.tasks);
  const [tab, setTab] = useState<Tab>("active");

  useEffect(() => {
    void useDownloadsStore.getState().hydrate();
  }, []);

  const active = useMemo(
    () => tasks.filter((task) => task.status === "downloading"),
    [tasks],
  );
  const finished = useMemo(
    () => tasks.filter((task) => isTerminalStatus(task.status)),
    [tasks],
  );

  const confirmRemove = (task: DownloadTask) => {
    Alert.alert(t("downloads.deleteConfirmTitle"), task.filename, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("downloads.delete"),
        style: "destructive",
        onPress: () => {
          void useDownloadsStore.getState().removeTask(task.id);
        },
      },
    ]);
  };

  const confirmClearFinished = () => {
    Alert.alert(
      t("downloads.deleteConfirmTitle"),
      t("downloads.deleteConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("downloads.clearFinished"),
          style: "destructive",
          onPress: () => {
            void useDownloadsStore.getState().clearFinished();
          },
        },
      ],
    );
  };

  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
      <View className="flex-row items-center gap-2 px-4 pt-3">
        <TabPill
          active={tab === "active"}
          label={t("downloads.tab.active")}
          count={active.length}
          onPress={() => setTab("active")}
        />
        <TabPill
          active={tab === "finished"}
          label={t("downloads.tab.finished")}
          count={finished.length}
          onPress={() => setTab("finished")}
        />
        {tab === "finished" && finished.length > 0 ? (
          <Pressable
            onPress={confirmClearFinished}
            className="ml-auto flex-row items-center gap-1 px-2 py-1.5 rounded-full bg-muted active:opacity-80"
            accessibilityLabel={t("downloads.clearFinished")}
          >
            <Ionicons name="trash-outline" size={13} color={theme.mutedForeground} />
            <Text className="text-xs text-muted-foreground">
              {t("downloads.clearFinished")}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {tab === "active" ? (
        active.length === 0 ? (
          <EmptyState icon="cloud-download-outline" text={t("downloads.emptyActive")} />
        ) : (
          <View className="gap-2 px-4 py-3">
            {active.map((task) => (
              <ActiveRow key={task.id} task={task} theme={theme} />
            ))}
          </View>
        )
      ) : finished.length === 0 ? (
        <EmptyState icon="archive-outline" text={t("downloads.emptyFinished")} />
      ) : (
        <View className="gap-2 px-4 py-3">
          {finished.map((task) => (
            <FinishedRow
              key={task.id}
              task={task}
              theme={theme}
              onOpen={(uri, mime) =>
                void Sharing.shareAsync(uri, { mimeType: mime })
              }
              onRetry={() => useDownloadsStore.getState().retry(task.id)}
              onDelete={() => confirmRemove(task)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function TabPill({
  active,
  label,
  count,
  onPress,
}: {
  active: boolean;
  label: string;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-row items-center gap-1.5 rounded-full px-4 py-1.5",
        active ? "bg-foreground" : "bg-muted",
      )}
    >
      <Text
        className={cn(
          "text-xs font-medium",
          active ? "text-background" : "text-muted-foreground",
        )}
      >
        {label}
      </Text>
      {count > 0 ? (
        <View
          className={cn(
            "min-w-[18px] h-[18px] rounded-full items-center justify-center px-1",
            active ? "bg-background/20" : "bg-primary",
          )}
        >
          <Text
            className={cn(
              "text-[10px] font-semibold",
              active ? "text-background" : "text-white",
            )}
          >
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ActiveRow({
  task,
  theme,
}: {
  task: DownloadTask;
  theme: typeof THEME["light"];
}) {
  const { t } = useTranslation();
  const pct = task.totalBytes ? Math.round(task.progress * 100) : null;
  return (
    <View className="rounded-xl border border-border bg-card px-3 py-2.5">
      <View className="flex-row items-center gap-2">
        <Ionicons name="download-outline" size={16} color={theme.mutedForeground} />
        <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
          {task.filename}
        </Text>
        {pct != null ? (
          <Text className="text-xs text-muted-foreground tabular-nums">
            {pct}%
          </Text>
        ) : null}
        <Pressable
          onPress={() => useDownloadsStore.getState().cancel(task.id)}
          className="rounded-full bg-muted px-2.5 py-1 active:opacity-80"
          accessibilityLabel={t("downloads.cancel")}
        >
          <Text className="text-xs text-muted-foreground">{t("downloads.cancel")}</Text>
        </Pressable>
      </View>
      <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <View
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.round(task.progress * 100)}%` }}
        />
      </View>
      <SourceLine task={task} />
    </View>
  );
}

function FinishedRow({
  task,
  theme,
  onOpen,
  onRetry,
  onDelete,
}: {
  task: DownloadTask;
  theme: typeof THEME["light"];
  onOpen: (uri: string, mimeType: string) => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const icon =
    task.status === "completed"
      ? "checkmark-circle"
      : task.status === "failed"
        ? "alert-circle"
        : "close-circle";
  const iconColor =
    task.status === "completed"
      ? theme.primary
      : task.status === "failed"
        ? theme.destructive
        : theme.mutedForeground;
  return (
    <View className="rounded-xl border border-border bg-card px-3 py-2.5">
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={16} color={iconColor} />
        <View className="flex-1 min-w-0">
          <Text className="text-sm text-foreground" numberOfLines={1}>
            {task.filename}
          </Text>
        </View>
        {task.status === "completed" && task.localUri ? (
          <Pressable
            onPress={() => {
              onOpen(task.localUri!, mimeTypeForFilename(task.filename));
            }}
            className="flex-row items-center gap-1 rounded-full bg-muted px-2.5 py-1 active:opacity-80"
            accessibilityLabel={t("downloads.open")}
          >
            <Ionicons name="open-outline" size={12} color={theme.mutedForeground} />
            <Text className="text-xs text-muted-foreground">{t("downloads.open")}</Text>
          </Pressable>
        ) : task.status === "failed" ? (
          <Pressable
            onPress={onRetry}
            className="flex-row items-center gap-1 rounded-full bg-muted px-2.5 py-1 active:opacity-80"
            accessibilityLabel={t("downloads.retry")}
          >
            <Ionicons name="refresh" size={12} color={theme.mutedForeground} />
            <Text className="text-xs text-muted-foreground">{t("downloads.retry")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onDelete}
          className="rounded-full bg-muted px-2.5 py-1 active:opacity-80"
          accessibilityLabel={t("downloads.delete")}
        >
          <Text className="text-xs text-muted-foreground">{t("downloads.delete")}</Text>
        </Pressable>
      </View>
      <View className="mt-1 flex-row items-center gap-2">
        <StatusLabel task={task} />
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {formatDownloadTime(task.completedAt ?? task.createdAt)}
        </Text>
        <SourceLine task={task} />
      </View>
    </View>
  );
}

function StatusLabel({ task }: { task: DownloadTask }) {
  const { t } = useTranslation();
  const key =
    task.status === "completed"
      ? "downloads.completed"
      : task.status === "failed"
        ? "downloads.failed"
        : "downloads.cancelled";
  return <Text className="text-xs text-muted-foreground">{t(key)}</Text>;
}

/** Source label: localized kind + optional context name, e.g. "聊天 ·
 *  修复登录" / "Issue · MUL-123". */
function SourceLine({ task }: { task: DownloadTask }) {
  const { t } = useTranslation();
  const name = downloadSourceName(task.source);
  const label = t(downloadSourceLabelKey(task.source));
  return (
    <Text className="text-xs text-muted-foreground" numberOfLines={1}>
      {name ? `${label} · ${name}` : label}
    </Text>
  );
}

function EmptyState({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  return (
    <View className="items-center px-4 py-10">
      <Ionicons name={icon} size={36} color={theme.mutedForeground} />
      <Text className="mt-2 text-sm text-muted-foreground text-center">{text}</Text>
    </View>
  );
}

/** Completed-at / created-at time as a compact localized string. */
export function formatDownloadTime(ms: number | null | undefined): string {
  const date = new Date(ms ?? 0);
  if (Number.isNaN(date.getTime()) || !ms) return "";
  return date.toLocaleString(getCurrentLocale() === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}