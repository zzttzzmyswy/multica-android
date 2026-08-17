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
 */
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { ChatSession } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { chatSessionsOptions, sortChatSessions } from "@/data/queries/chat";
import { agentListOptions } from "@/data/queries/agents";
import { useChatSessionPickerStore } from "@/data/stores/chat-session-picker-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useChatSessionActions } from "@/components/chat/session-actions";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";

export default function ChatSessionsRoute() {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: sessions = [] } = useQuery(chatSessionsOptions(wsId));
  const { showActions, renameDialog } = useChatSessionActions();
  // agent_id → display name, so each session row can say who it's chatting
  // with (MYS-335). Sessions can outlive their agent (archived / removed),
  // so unknown ids fall back to a placeholder.
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));
  const activeSessionId = useChatSessionPickerStore((s) => s.activeSessionId);
  const requestSelect = useChatSessionPickerStore((s) => s.requestSelect);
  // Pinned rows sort above the rest (web parity); keep a memoized copy so the
  // sheet's order follows pin/unpin without a refetch.
  const sortedSessions = sortChatSessions(sessions);

  const openActions = (session: ChatSession) =>
    showActions(session, {
      onDeleted: (dead) => {
        // If we just deleted the active one, the chat tab clears its
        // local activeSessionId via the picker-store request.
        if (dead.id === activeSessionId) {
          requestSelect(null);
        }
      },
    });

  return (
    <View className="flex-1">
      <View className="px-4 pt-4 pb-3">
        <Text className="text-base font-semibold text-foreground">{t("chat.chats")}</Text>
      </View>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {sortedSessions.length === 0 ? (
          <View className="px-4 py-8">
            <Text className="text-sm text-muted-foreground text-center">
              {t("chat.noChatsYet")}
            </Text>
          </View>
        ) : (
          sortedSessions.map((session) => {
            const selected = session.id === activeSessionId;
            const archived = session.status === "archived";
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
                <View
                  className={cn(
                    "h-2 w-2 rounded-full",
                    session.has_unread ? "bg-primary" : "bg-transparent",
                  )}
                />
                <ActorAvatar
                  type="agent"
                  id={session.agent_id}
                  size={32}
                  showPresence
                />
                <View className="flex-1">
                  <View className="flex-row items-center gap-1">
                    <Text
                      className={cn(
                        "text-sm text-foreground shrink",
                        session.has_unread && "font-semibold",
                      )}
                      numberOfLines={1}
                    >
                      {session.title || t("chat.untitled")}
                    </Text>
                    {session.pinned ? (
                      <Text className="text-[10px] text-muted-foreground">
                        {t("chat.pinned")}
                      </Text>
                    ) : null}
                  </View>
                  <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                    {agentNameById.get(session.agent_id) ?? t("chat.agentUnknown")}
                  </Text>
                  {archived ? (
                    <Text className="text-xs text-muted-foreground mt-0.5">
                      {t("chat.archived")}
                    </Text>
                  ) : null}
                </View>
                {selected ? (
                  <Text className="text-sm text-primary font-semibold">✓</Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
      {renameDialog}
    </View>
  );
}
