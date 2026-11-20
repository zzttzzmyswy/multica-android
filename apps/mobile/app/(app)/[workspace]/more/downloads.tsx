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
import { useEffect, useMemo, useRef, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Text } from "@/components/ui/text";
import { DOWNLOAD_ERROR_INTERRUPTED, useDownloadsStore } from "@/data/downloads-store";
import { formatBytes } from "@/lib/format-bytes";
import { mimeTypeForFilename } from "@/lib/attachment-download";
import { installApkFile, openUnknownAppSourcesSettings } from "@/lib/install-update";
import {
  downloadSourceLabelKey,
  downloadSourceName,
  isTerminalStatus,
  type DownloadTask,
} from "@/lib/download-store";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { getCurrentLocale } from "@/lib/i18n";
import { useTranslation } from "@/lib/i18n/react";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";

type Tab = "active" | "finished";

export default function DownloadsPage() {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const tasks = useDownloadsStore((s) => s.tasks);
  const [tab, setTab] = useState<Tab>("active");
  const observingRetries = useRef(new Set<string>());

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

  const showInstallError = (err: unknown) => {
    Alert.alert(
      t("screen.downloads"),
      [t("update.error.installFailed"), err instanceof Error ? err.message : ""]
        .filter(Boolean)
        .join("\n"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("update.openSettings"),
          onPress: () => void openUnknownAppSourcesSettings(),
        },
      ],
    );
  };

  const retryTask = async (task: DownloadTask) => {
    const run = await useDownloadsStore.getState().retry(task.id).catch(() => {
      Alert.alert(t("screen.downloads"), t("downloads.retryFailed"));
    });
    if (!run || observingRetries.current.has(run.id)) return;
    observingRetries.current.add(run.id);
    if (useDownloadsStore.getState().tasks.some((row) => row.id === run.id && row.status === "downloading")) {
      setTab("active");
    }
    // Only the install handoff can reject after enqueue; network failures
    // resolve with a failed row and its reason.
    try {
      await run.done;
    } catch (err) {
      showInstallError(err);
    } finally {
      observingRetries.current.delete(run.id);
    }
  };

  /** Terminal open action: an update APK goes to the system installer
   *  (content-URI), everything else to the share/open sheet. Any `.apk`
   *  filename routes to the installer even when a persisted task lost its
   *  `update` source marker — a stale `update` kind silently falling back to
   *  the share sheet left users with "tapping open does nothing". */
  const openTask = (task: DownloadTask) => {
    const uri = task.localUri;
    if (!uri) return;
    const isApk =
      task.source.kind === "update" ||
      task.filename?.toLowerCase().endsWith(".apk");
    if (isApk) {
      void installApkFile(new File(uri)).catch(showInstallError);
      return;
    }
    void Sharing.shareAsync(uri, { mimeType: mimeTypeForFilename(task.filename) });
  };

  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
      <View className="flex-row flex-wrap items-center gap-2 px-4 pt-3">
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
            className="ml-auto min-h-12 min-w-12 flex-row items-center justify-center gap-1 rounded-full bg-muted px-3 active:opacity-80"
            accessibilityRole="button"
            accessibilityLabel={t("downloads.clearFinished")}
          >
            <Ionicons name="trash-outline" size={13} color={theme.mutedForeground} />
            <Text className="text-caption text-muted-foreground">
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
              onOpen={() => openTask(task)}
              onRetry={() => void retryTask(task)}
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
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      className={cn(
        "min-h-12 min-w-12 flex-row items-center gap-1.5 rounded-full px-4",
        active ? "bg-foreground" : "bg-muted",
      )}
    >
      <Text
        className={cn(
          "text-caption font-medium",
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
              "text-micro font-semibold",
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
  const pct = task.totalBytes != null && Number.isFinite(task.totalBytes) && task.totalBytes > 0
    ? Math.round(task.progress * 100)
    : null;
  const received = task.bytesWritten ?? 0;
  return (
    <View className="rounded-xl border border-border bg-card px-3 py-2.5">
      <View className="flex-row items-start gap-2">
        <Ionicons name="download-outline" size={16} color={theme.mutedForeground} />
        <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={3}>
          {task.filename}
        </Text>
      </View>
      <SourceLine task={task} />
      {pct != null ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t("downloads.downloading")}
          accessibilityValue={{ min: 0, max: 100, now: pct }}
          className="mt-2 gap-1"
        >
          <View className="h-1.5 overflow-hidden rounded-full bg-muted">
            <View className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </View>
          <Text className="text-caption text-muted-foreground tabular-nums">{pct}%</Text>
        </View>
      ) : (
        <Text className="mt-2 text-caption text-muted-foreground tabular-nums">
          {received > 0
            ? t("downloads.receivedBytes", { size: formatBytes(received) })
            : t("downloads.downloading")}
        </Text>
      )}
      <View className="mt-2 flex-row flex-wrap justify-end gap-2">
        <Pressable
          onPress={() => void useDownloadsStore.getState().cancel(task.id)}
          className={ACTION_CLASS}
          accessibilityRole="button"
        >
          <Text className="text-caption text-muted-foreground">{t("downloads.cancel")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const ACTION_CLASS =
  "min-h-12 min-w-12 flex-row items-center justify-center gap-1 rounded-full bg-muted px-3 active:opacity-80";

function FinishedRow({
  task,
  theme,
  onOpen,
  onRetry,
  onDelete,
}: {
  task: DownloadTask;
  theme: typeof THEME["light"];
  onOpen: () => void;
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
      <View className="flex-row items-start gap-2">
        <Ionicons name={icon} size={16} color={iconColor} />
        <Text className="min-w-0 flex-1 text-body text-foreground" numberOfLines={3}>
          {task.filename}
        </Text>
      </View>
      <View className="mt-1 flex-row flex-wrap items-center gap-x-2">
        <StatusLabel task={task} />
        <Text className="text-caption text-muted-foreground">
          {formatDownloadTime(task.completedAt ?? task.createdAt)}
        </Text>
      </View>
      <SourceLine task={task} />
      {task.status === "failed" && task.error ? (
        <Text className="mt-1 text-caption text-destructive" numberOfLines={3}>
          {task.error === DOWNLOAD_ERROR_INTERRUPTED ? t("downloads.error.interrupted") : task.error}
        </Text>
      ) : null}
      <View className="mt-2 flex-row flex-wrap justify-end gap-2">
        {task.status === "completed" && task.localUri ? (
          <Pressable onPress={onOpen} className={ACTION_CLASS} accessibilityRole="button">
            <Ionicons name="open-outline" size={12} color={theme.mutedForeground} />
            <Text className="text-caption text-muted-foreground">{t("downloads.open")}</Text>
          </Pressable>
        ) : task.status === "failed" || task.status === "cancelled" ? (
          <Pressable onPress={onRetry} className={ACTION_CLASS} accessibilityRole="button">
            <Ionicons name="refresh" size={12} color={theme.mutedForeground} />
            <Text className="text-caption text-muted-foreground">{t("downloads.retry")}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onDelete} className={ACTION_CLASS} accessibilityRole="button">
          <Text className="text-caption text-muted-foreground">{t("downloads.delete")}</Text>
        </Pressable>
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
  return <Text className="text-caption text-muted-foreground">{t(key)}</Text>;
}

/** Source label: localized kind + optional context name, e.g. "聊天 ·
 *  修复登录" / "Issue · MUL-123". */
function SourceLine({ task }: { task: DownloadTask }) {
  const { t } = useTranslation();
  const name = downloadSourceName(task.source);
  const label = t(downloadSourceLabelKey(task.source));
  return (
    <Text className="text-caption text-muted-foreground" numberOfLines={1}>
      {name ? `${label} · ${name}` : label}
    </Text>
  );
}

function EmptyState({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  const theme = useThemePalette();
  return (
    <View className="items-center px-4 py-10">
      <Ionicons name={icon} size={36} color={theme.mutedForeground} />
      <Text className="mt-2 text-body text-muted-foreground text-center">{text}</Text>
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