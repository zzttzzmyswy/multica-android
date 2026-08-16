/**
 * AI-builder setup (more/agents/new/ai). Mirrors web
 * `builder-setup-panel.tsx` + `unfinished-drafts.tsx`: lists the caller's
 * unfinished creation conversations (resume / discard), picks the runtime a
 * NEW conversation will run on, and starts one.
 *
 * The runtime cannot be deferred — it is frozen onto the hidden carrier agent
 * when the session is created. Only online + usable runtimes are offered
 * (usableRuntimes), same predicate the manual form uses.
 *
 * A single unfinished draft is resumed straight through the banner row
 * (one-item chooser); several are listed so the user picks the right one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentBuilderSessionSummary, RuntimeDevice } from "@multica/core/types";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { RuntimePickerSheet } from "@/components/agent/runtime-picker-sheet";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  agentBuilderSessionListOptions,
  agentKeys,
} from "@/data/queries/agents";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { chatKeys } from "@/data/queries/chat";
import {
  builderDraftPreview,
  builderDraftTitle,
} from "@/lib/agent-builder";
import { usableRuntimes } from "@/lib/agent-create";
import { useTranslation } from "@/lib/i18n/react";
import { useTimeAgo } from "@/lib/time-ago";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export default function AiBuilderSetupPage() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const timeAgo = useTimeAgo();
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery(
    agentBuilderSessionListOptions(wsId),
  );
  const { data: runtimes = [], isLoading: runtimesLoading } = useQuery(
    runtimeListOptions(wsId),
  );
  const usable = useMemo(
    () => usableRuntimes(runtimes, currentUserId),
    [runtimes, currentUserId],
  );

  // Seed the first usable runtime so "Start conversation" is one tap after
  // landing (mirrors use-create-agent-form seeding the manual form).
  const [runtimeId, setRuntimeId] = useState<string | null>(null);
  const selectedRuntime =
    runtimes.find((runtime) => runtime.id === runtimeId) ?? null;
  useEffect(() => {
    if (runtimeId !== null || usable.length === 0) return;
    setRuntimeId(usable[0].id);
  }, [runtimeId, usable]);

  const [runtimePickerOpen, setRuntimePickerOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidateSessions = useCallback(() => {
    void qc.invalidateQueries({ queryKey: agentKeys.builderSessions(wsId) });
  }, [qc, wsId]);

  const openSession = useCallback(
    (sessionId: string) => {
      if (!wsSlug) return;
      router.push({
        pathname: "/[workspace]/more/agents/builder/[sessionId]",
        params: {
          workspace: wsSlug,
          sessionId,
          runtime: runtimeId,
        },
      });
    },
    [wsSlug, runtimeId],
  );

  const handleStart = useCallback(async () => {
    if (!runtimeId) return;
    setStarting(true);
    setError(null);
    try {
      const session = await api.createAgentBuilderSession({ runtime_id: runtimeId });
      if (!session.session_id) throw new Error(t("agents.new.ai.startFailed"));
      invalidateSessions();
      openSession(session.session_id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("agents.new.ai.startFailed"),
      );
    } finally {
      setStarting(false);
    }
  }, [runtimeId, invalidateSessions, openSession, t]);

  const handleDiscard = useCallback(
    (session: AgentBuilderSessionSummary) => {
      Alert.alert(
        t("agents.new.ai.discardTitle"),
        t("agents.new.ai.discardMessage"),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("agents.new.ai.discard"),
            style: "destructive",
            onPress: () => {
              void api
                .deleteChatSession(session.session_id)
                .then(invalidateSessions)
                .catch(() => invalidateSessions());
              qc.removeQueries({ queryKey: chatKeys.messages(session.session_id) });
              qc.removeQueries({ queryKey: chatKeys.pendingTask(session.session_id) });
            },
          },
        ],
        { cancelable: true },
      );
    },
    [t, invalidateSessions, qc],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: t("agents.new.title"),
          headerBackTitle: t("common.back"),
        }}
      />
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="px-5 py-6 gap-6"
        keyboardShouldPersistTaps="handled"
      >
        {/* Unfinished conversations — the only route back to one lives on this
            screen, so they must stay reachable before the picker for a new one. */}
        <View className="gap-2">
          <Text className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("agents.new.ai.unfinished")}
          </Text>
          {sessionsLoading ? (
            <View className="py-6 items-center">
              <ActivityIndicator />
            </View>
          ) : sessions.length === 0 ? (
            <View className="rounded-xl border border-border bg-secondary/30 px-4 py-4">
              <Text className="text-sm text-muted-foreground">
                {t("agents.new.ai.unfinishedEmpty")}
              </Text>
            </View>
          ) : (
            <View className="rounded-xl border border-border overflow-hidden">
              {sessions.map((session, index) => {
                const title = builderDraftTitle(session);
                const preview = builderDraftPreview(session);
                return (
                  <View
                    key={session.session_id}
                    className={cn(
                      "flex-row items-center gap-2 px-4 py-3",
                      index > 0 && "border-t border-border",
                    )}
                  >
                    <Pressable
                      onPress={() => openSession(session.session_id)}
                      className="flex-1 min-w-0 gap-0.5"
                      accessibilityLabel={t("agents.new.ai.resume")}
                    >
                      <View className="flex-row items-baseline gap-2">
                        <Text
                          className="text-sm font-medium text-foreground"
                          numberOfLines={1}
                        >
                          {title || t("agents.new.ai.untitled")}
                        </Text>
                        {session.last_message_at ? (
                          <Text className="text-[11px] text-muted-foreground shrink-0">
                            {timeAgo(session.last_message_at)}
                          </Text>
                        ) : null}
                      </View>
                      {preview ? (
                        <Text
                          className="text-xs text-muted-foreground"
                          numberOfLines={2}
                        >
                          {preview}
                        </Text>
                      ) : null}
                    </Pressable>
                    <Pressable
                      onPress={() => handleDiscard(session)}
                      accessibilityLabel={t("agents.new.ai.discard")}
                      className="size-8 items-center justify-center rounded-md active:bg-secondary"
                    >
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color={theme.mutedForeground}
                      />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* New conversation */}
        <View className="gap-2">
          <Text className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t("agents.new.ai.newConversation")}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t("agents.new.ai.chooseRuntimeHint")}
          </Text>
          <Pressable
            onPress={() => setRuntimePickerOpen(true)}
            disabled={runtimesLoading || starting}
            accessibilityLabel={t("agents.new.runtimeLabel")}
            className="flex-row items-center gap-2.5 rounded-md border border-border bg-secondary/50 px-3 py-2.5"
          >
            {selectedRuntime ? (
              <>
                <Ionicons
                  name={selectedRuntime.runtime_mode === "cloud" ? "cloud" : "hardware-chip"}
                  size={16}
                  color={theme.mutedForeground}
                />
                <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                  {runtimeDisplayLabel(selectedRuntime)}
                </Text>
                {selectedRuntime.visibility !== "public" ? (
                  <Text className="text-[10px] text-info">
                    {t("runtimes.visibility.private")}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text className="flex-1 text-sm text-muted-foreground">
                {runtimesLoading
                  ? t("agents.new.runtimesLoading")
                  : t("agents.new.runtimePlaceholder")}
              </Text>
            )}
            <Ionicons name="chevron-down" size={16} color={theme.mutedForeground} />
          </Pressable>
          {usable.length === 0 && !runtimesLoading ? (
            <Text className="text-xs text-destructive">
              {t("agents.new.ai.noRuntimes")}
            </Text>
          ) : null}

          {error ? (
            <View className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5">
              <Text className="text-sm text-destructive">{error}</Text>
            </View>
          ) : null}

          <Button onPress={() => void handleStart()} disabled={starting || !runtimeId}>
            <Text>
              {starting
                ? t("agents.new.ai.starting")
                : t("agents.new.ai.startConversation")}
            </Text>
          </Button>
        </View>
      </ScrollView>

      <RuntimePickerSheet
        visible={runtimePickerOpen}
        runtimes={usable}
        loading={runtimesLoading}
        selectedId={runtimeId}
        onPick={(runtime: RuntimeDevice) => setRuntimeId(runtime.id)}
        onClose={() => setRuntimePickerOpen(false)}
      />
    </>
  );
}