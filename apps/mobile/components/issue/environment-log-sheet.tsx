/**
 * The end of a declared environment's log, read from its machine on demand
 * (MYS-2980). Mirrors web's
 * `packages/views/issues/components/environment-log-dialog.tsx`.
 *
 * Why this is a sheet and not a route: it is a peek at one row's output, opened
 * and dismissed while the reader is looking at the issue. Web uses a dialog for
 * the same reason; on a phone the sheet is the native equivalent.
 *
 * Three facts about the data shape drive the whole component:
 *
 *  1. **The machine answers asynchronously.** `POST …/logs` queues a command
 *     and returns its id; the output arrives when the daemon replies. So the
 *     sheet polls `issueEnvironmentCommandOptions` — 1s while pending, never
 *     after — and shows a spinner until the answer lands.
 *  2. **An offline machine cannot answer.** The sheet then falls back to the
 *     lines the environment printed before it crashed (`env.excerpt`), which the
 *     server redacted. Showing an empty pane instead would hide the only
 *     evidence the reader can get.
 *  3. **"Follow" is a timer, not a socket.** While the row is live and follow is
 *     on, the sheet re-asks every 5s. This is web's `FOLLOW_INTERVAL`; the
 *     daemon has no streaming log endpoint.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { IssueEnvironment } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { api } from "@/data/api";
import { issueEnvironmentCommandOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";
import { classifyLogLines, exitCode, isLive } from "@/lib/issue-environments";

/** How often a live, followed log re-asks the machine. Web's
 *  `FOLLOW_INTERVAL` (`environment-log-dialog.tsx:22`). */
const FOLLOW_INTERVAL = 5_000;

interface LogSnapshot {
  output: string;
  readAt: string;
}

export function EnvironmentLogSheet({
  issueId,
  env,
  visible,
  onClose,
  machineTitle,
  offline,
  canRestart,
  onRestart,
}: {
  issueId: string;
  env: IssueEnvironment;
  visible: boolean;
  onClose: () => void;
  machineTitle: string | null;
  offline: boolean;
  canRestart: boolean;
  onRestart: () => void;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const timeAgo = useTimeAgo();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LogSnapshot | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const live = isLive(env);

  const request = useMutation({
    mutationFn: () => api.readIssueEnvironmentLogs(issueId, env.id),
    onSuccess: (command) => {
      setFailed(null);
      setCommandId(command.id || null);
    },
    onError: (error) =>
      setFailed(error instanceof Error ? error.message : String(error)),
  });
  const { data: command } = useQuery(
    issueEnvironmentCommandOptions(wsId, issueId, commandId),
  );
  const reading = request.isPending || command?.status === "pending";

  // A settled command becomes the snapshot. It is deliberately kept in state
  // rather than read straight from the query: the follow timer re-asks, and
  // each answer replaces the id, so reading `command` would blank the pane for
  // one render between answers.
  useEffect(() => {
    if (!command || command.id !== commandId) return;
    if (command.status === "succeeded") {
      setSnapshot({
        output: command.output ?? "",
        readAt: command.completed_at ?? new Date().toISOString(),
      });
      setFailed(null);
    } else if (command.status === "failed" || command.status === "expired") {
      setFailed(command.error || t("environments.log.noResponse"));
    }
  }, [command, commandId, t]);

  const refresh = request.mutate;
  useEffect(() => {
    if (visible && !offline) refresh();
  }, [visible, offline, refresh]);

  // Re-ask while the row is live. Stops on any settle condition, so a dead
  // machine does not leave a timer spinning every 5s.
  useEffect(() => {
    if (!visible || offline || !live || !follow || reading || failed) return;
    const timer = setTimeout(() => refresh(), FOLLOW_INTERVAL);
    return () => clearTimeout(timer);
  }, [visible, offline, live, follow, reading, failed, refresh, snapshot]);

  const lines = useMemo(() => {
    const text = offline ? env.excerpt : (snapshot?.output ?? "");
    return text ? text.replace(/\n$/, "").split("\n") : [];
  }, [offline, env.excerpt, snapshot]);
  const levels = useMemo(() => classifyLogLines(lines), [lines]);
  const visibleLines = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return lines
      .map((text, index) => ({ text, index, level: levels[index] ?? null }))
      .filter((line) => !needle || line.text.toLowerCase().includes(needle));
  }, [lines, levels, filter]);

  const title = env.label || env.name;
  const code = exitCode(env);
  const subtitle = [machineTitle, live ? null : offline ? t("environments.offline") : null]
    .filter(Boolean)
    .join(" · ");

  const copyAll = useCallback(() => {
    void Clipboard.setStringAsync(lines.join("\n")).then((ok) => {
      // RN's clipboard resolves to void on some platforms; treat "no throw" as
      // success rather than claiming a failure we cannot observe.
      if (ok === false) return;
    });
  }, [lines]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="bg-popover rounded-t-2xl max-h-[85%]">
            {/* Header — the row's name, the machine it runs on, and the two
                actions a reader wants without scrolling down: refresh and
                copy. */}
            <View className="px-4 py-3 border-b border-border flex-row items-start gap-2">
              <View className="flex-1 min-w-0">
                <Text className="text-title-sm font-semibold text-foreground" numberOfLines={1}>
                  {t("environments.log.title", { name: title })}
                </Text>
                {subtitle ? (
                  <Text className="text-micro text-muted-foreground" numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={() => void refresh()}
                hitSlop={8}
                disabled={offline || reading}
                accessibilityRole="button"
                accessibilityLabel={t("environments.log.refresh")}
                className="p-1 active:opacity-70"
              >
                <Ionicons
                  name="refresh"
                  size={18}
                  color={offline ? theme.mutedForeground : theme.foreground}
                />
              </Pressable>
              <Pressable
                onPress={copyAll}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("environments.log.copy")}
                className="p-1 active:opacity-70"
              >
                <Ionicons name="copy-outline" size={18} color={theme.foreground} />
              </Pressable>
              <Pressable
                onPress={onClose}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("environments.cancel")}
                className="p-1 active:opacity-70"
              >
                <Ionicons name="close" size={20} color={theme.foreground} />
              </Pressable>
            </View>

            {/* Filter + follow — the two controls a reader uses on a long log.
                Both are state, not server calls, so they never re-ask. */}
            <View className="px-4 py-2 flex-row items-center gap-2 border-b border-border">
              <View className="flex-1 flex-row items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <Ionicons name="search" size={13} color={theme.mutedForeground} />
                <TextInput
                  value={filter}
                  onChangeText={setFilter}
                  placeholder={t("environments.log.filter")}
                  placeholderTextColor={theme.mutedForeground}
                  className="flex-1 text-caption text-foreground py-0.5"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Pressable
                onPress={() => setFollow((v) => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: follow }}
                className={`rounded-md px-2 py-1 ${follow ? "bg-brand/10" : "bg-secondary"}`}
              >
                <Text
                  className={`text-micro font-medium ${follow ? "text-brand" : "text-muted-foreground"}`}
                >
                  {t("environments.log.follow")}
                </Text>
              </Pressable>
            </View>

            {offline ? (
              <Text className="px-4 py-2 text-micro text-muted-foreground">
                {env.excerpt
                  ? t("environments.log.offlineExcerpt")
                  : t("environments.log.offlineEmpty")}
              </Text>
            ) : null}

            <ScrollView className="px-4 py-2 max-h-[52vh]" contentContainerStyle={{ paddingBottom: 8 }}>
              {failed ? (
                <View className="py-2 gap-1">
                  <Text className="text-caption text-destructive">
                    {t("environments.log.failed", { error: failed })}
                  </Text>
                  {!offline ? (
                    <Pressable
                      onPress={() => void refresh()}
                      accessibilityRole="button"
                      className="self-start rounded-md bg-secondary px-2 py-1 active:opacity-70"
                    >
                      <Text className="text-caption font-medium text-foreground">
                        {t("environments.retry")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : reading && !snapshot && lines.length === 0 ? (
                <View className="py-4 items-center gap-2">
                  <ActivityIndicator />
                  <Text className="text-caption text-muted-foreground">
                    {t("environments.log.loading")}
                  </Text>
                </View>
              ) : visibleLines.length === 0 ? (
                <Text className="py-2 text-caption text-muted-foreground">
                  {filter.trim()
                    ? t("environments.log.noMatch")
                    : offline
                      ? t("environments.log.offlineEmpty")
                      : t("environments.log.empty")}
                </Text>
              ) : (
                visibleLines.map((line) => (
                  <Text
                    key={line.index}
                    className={`text-micro font-mono ${
                      line.level === "error"
                        ? "text-destructive"
                        : line.level === "warn"
                          ? "text-amber-600 dark:text-amber-500"
                          : "text-foreground"
                    }`}
                  >
                    {line.text}
                  </Text>
                ))
              )}
            </ScrollView>

            {/* Footer — how much is shown, and when it was read. A crashed
                row states its exit code here, which is the fact a reader
                looking at a dead service came for. */}
            <View className="px-4 py-2 border-t border-border flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-micro text-muted-foreground" numberOfLines={1}>
                {offline
                  ? t("environments.log.offlineEmpty")
                  : lines.length === 0
                    ? t("environments.log.empty")
                    : t(
                        lines.length === 1
                          ? "environments.log.footer_one"
                          : "environments.log.footer_other",
                        {
                          count: lines.length,
                          time: timeAgo(snapshot?.readAt ?? env.last_seen_at),
                        },
                      )}
              </Text>
              {!live && !offline && env.ended_at ? (
                <Text className="text-micro text-muted-foreground" numberOfLines={1}>
                  {code !== null
                    ? t("environments.log.exitDividerCode", {
                        time: timeAgo(env.ended_at),
                        code,
                      })
                    : t("environments.log.exitDivider", { time: timeAgo(env.ended_at) })}
                </Text>
              ) : null}
              {canRestart ? (
                <Pressable
                  onPress={() => {
                    onRestart();
                    onClose();
                  }}
                  accessibilityRole="button"
                  className="rounded-md border border-border px-2 py-1 active:opacity-70"
                >
                  <Text className="text-micro font-medium text-foreground">
                    {t("environments.restart")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
