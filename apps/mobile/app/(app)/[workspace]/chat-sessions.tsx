/**
 * Chat session-switch sheet — presented as a formSheet by the parent Stack.
 * Reads the session list from the chat cache and writes the user's pick
 * through a shared "active session" store so the chat tab picks it up on
 * dismiss.
 *
 * Why a tiny dedicated store: the chat tab's `activeSessionId` used to live
 * as a `useState` inside `chat.tsx`, but now that session picking happens
 * on a separate route screen, we need a cross-screen channel. Same minimum
 * pattern as `useNewIssueDraftStore` for the new-issue form.
 *
 * IM-style list (MYS-449, aligned with web chat-thread-list.tsx): each row is
 * avatar + title + last-message preview + IM timestamp, a red unread *count*
 * badge, and a "typing…" indicator for sessions with an in-flight task. Two
 * views toggled locally: history (active chats + footer entry into the
 * archive) and archived (the ONLY place a chat can be hard-deleted — long-
 * press → unarchive + delete, mirroring web's archived view).
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { ChatSession } from "@multica/core/types";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import {
  chatSessionsOptions,
  pendingChatTasksOptions,
  splitChatSessions,
} from "@/data/queries/chat";
import { agentListOptions } from "@/data/queries/agents";
import { useChatSessionPickerStore } from "@/data/stores/chat-session-picker-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useChatSessionActions } from "@/components/chat/session-actions";
import {
  formatChatTime,
  toPreview,
  unreadBadgeText,
} from "@/lib/chat-thread-display";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";

export default function ChatSessionsRoute() {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: sessions = [] } = useQuery(chatSessionsOptions(wsId));
  const { showActions, renameDialog } = useChatSessionActions();
  // agent_id → display name: unknown ids fall back to a placeholder
  // (MYS-335), and an empty session title falls back to the agent name.
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));
  const activeSessionId = useChatSessionPickerStore((s) => s.activeSessionId);
  const requestSelect = useChatSessionPickerStore((s) => s.requestSelect);

  // Flat cache split on `status` locally (web parity): active chats fill the
  // default history view, archived chats fill the archived view. Each bucket
  // sorted pinned-first then by activity.
  const { history: historySessions, archived: archivedSessions } =
    useMemo(() => splitChatSessions(sessions), [sessions]);

  // In-flight chat tasks — the per-row "typing…" indicator. Refreshed by the
  // listing-level realtime hook on task lifecycle events.
  const { data: pending } = useQuery(pendingChatTasksOptions(wsId));
  const pendingBySessionId = useMemo(
    () => new Map((pending?.tasks ?? []).map((task) => [task.chat_session_id, task])),
    [pending],
  );

  // Which view is showing. Falls back to history when the archived list
  // drains (last chat unarchived / deleted) so we never strand the user on
  // an empty archive (web behaviour).
  const [view, setView] = useState<"history" | "archived">("history");
  useEffect(() => {
    if (view === "archived" && archivedSessions.length === 0) {
      setView("history");
    }
  }, [view, archivedSessions.length]);

  const openActions = (session: ChatSession) =>
    showActions(session, {
      archivedView: view === "archived",
      onDeleted: (dead) => {
        // If we just deleted the active one, the chat tab clears its
        // local activeSessionId via the picker-store request.
        if (dead.id === activeSessionId) {
          requestSelect(null);
        }
      },
    });

  const renderRow = (session: ChatSession) => {
    const selected = session.id === activeSessionId;
    // Current session doesn't badge its own unread (web: `isCurrent ? 0`).
    const unread = selected ? 0 : (session.unread_count ?? 0);
    const isRunning = pendingBySessionId.has(session.id);
    const last = session.last_message ?? null;
    const timeText = last
      ? formatChatTime(last.created_at)
      : formatChatTime(session.updated_at);
    const titleText =
      session.title?.trim() ||
      (session.agent_id ? (agentNameById.get(session.agent_id) ?? "") : "") ||
      t("chat.untitled");

    // Second line: typing → failed → no_response hint → preview.
    let preview: React.ReactNode;
    if (isRunning) {
      preview = (
        <Text className="text-xs text-emerald-500" numberOfLines={1}>
          {t("chat.typing")}
        </Text>
      );
    } else if (last?.failure_reason) {
      preview = (
        <Text className="text-xs text-destructive" numberOfLines={1}>
          {t("chat.failedToSend")}
        </Text>
      );
    } else if (last?.message_kind === "no_response") {
      // A no_response turn stores a non-empty fallback as content; show a
      // localized hint instead (web MUL-4351 parity).
      preview = (
        <Text className="text-xs italic text-muted-foreground" numberOfLines={1}>
          {t("chat.noTextReply")}
        </Text>
      );
    } else if (last) {
      preview = (
        <Text
          className={cn(
            "text-xs",
            unread > 0 ? "text-foreground" : "text-muted-foreground",
          )}
          numberOfLines={1}
        >
          {last.role === "user" ? t("chat.youPrefix") : ""}
          {toPreview(last.content)}
        </Text>
      );
    } else {
      preview = (
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {t("chat.noMessagesYet")}
        </Text>
      );
    }

    return (
      <Pressable
        key={session.id}
        onPress={() => {
          requestSelect(session.id);
          router.back();
        }}
        onLongPress={() => openActions(session)}
        className={cn(
          "flex-row items-center gap-3 px-4 py-3 active:bg-secondary",
          selected && "bg-secondary/60",
        )}
      >
        <ActorAvatar
          type="agent"
          id={session.agent_id}
          size={40}
          showPresence
        />
        <View className="flex-1 min-w-0">
          {/* Line 1: title + pinned + time */}
          <View className="flex-row items-center gap-1">
            <Text
              className={cn(
                "text-sm shrink",
                unread > 0 ? "font-semibold text-foreground" : "text-foreground",
              )}
              numberOfLines={1}
            >
              {titleText}
            </Text>
            {session.pinned ? (
              <Text className="text-[10px] text-muted-foreground">
                {t("chat.pinned")}
              </Text>
            ) : null}
            <View className="flex-1" />
            <Text className="text-[11px] text-muted-foreground shrink-0">
              {timeText}
            </Text>
          </View>
          {/* Line 2: preview + unread badge */}
          <View className="mt-0.5 flex-row items-center gap-2">
            <View className="flex-1 min-w-0">{preview}</View>
            {unread > 0 ? (
              <View className="min-w-[18px] h-[18px] rounded-full bg-destructive items-center justify-center px-1 shrink-0">
                <Text className="text-[10px] font-semibold text-white">
                  {unreadBadgeText(unread)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        {selected ? (
          <Text className="text-sm text-primary font-semibold shrink-0">✓</Text>
        ) : null}
      </Pressable>
    );
  };

  // Archived view: back header, then the archived rows. Hard delete lives
  // only here (via each row's long-press menu) — web parity.
  if (view === "archived") {
    return (
      <View className="flex-1">
        <View className="flex-row items-center gap-2 px-4 pt-4 pb-3">
          <Pressable
            onPress={() => setView("history")}
            hitSlop={12}
            className="p-0.5"
            accessibilityLabel="back"
          >
            <Ionicons name="chevron-back" size={22} className="text-foreground" />
          </Pressable>
          <Text className="flex-1 text-base font-semibold text-foreground">
            {t("chat.archivedTitle")}
          </Text>
          <Text className="text-sm text-muted-foreground tabular-nums">
            {archivedSessions.length}
          </Text>
        </View>
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {archivedSessions.map(renderRow)}
        </ScrollView>
        {renameDialog}
      </View>
    );
  }

  // History (default) view: active rows + a footer entry into the archive.
  const archivedEntry =
    archivedSessions.length > 0 ? (
      <Pressable
        onPress={() => setView("archived")}
        className="flex-row items-center gap-3 px-4 py-3 mt-1 active:bg-secondary"
      >
        <View className="h-9 w-9 items-center justify-center rounded-full bg-muted">
          <Ionicons name="archive-outline" size={16} className="text-muted-foreground" />
        </View>
        <Text className="flex-1 text-sm font-medium text-muted-foreground">
          {t("chat.archivedTitle")}
        </Text>
        <Text className="text-sm text-muted-foreground tabular-nums">
          {archivedSessions.length}
        </Text>
        <Ionicons name="chevron-forward" size={14} className="text-muted-foreground" />
      </Pressable>
    ) : null;

  return (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-3">
        <Text className="text-base font-semibold text-foreground">{t("chat.chats")}</Text>
      </View>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {historySessions.length === 0 ? (
          <View className="px-4 py-8">
            <Text className="text-sm text-muted-foreground text-center">
              {t("chat.noChatsYet")}
            </Text>
          </View>
        ) : (
          historySessions.map(renderRow)
        )}
        {archivedEntry}
      </ScrollView>
      {renameDialog}
    </View>
  );
}