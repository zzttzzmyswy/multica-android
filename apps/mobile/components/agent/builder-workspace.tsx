/**
 * One AI-builder creation conversation (more/agents/builder/[sessionId]).
 * Mirrors web `builder-workspace.tsx` on a single tall screen: the chat on
 * top, the configurable draft in a switchable lower tab.
 *
 * The wire protocol is reused verbatim from core (builder-protocol via
 * lib/agent-builder): the composer encodes each turn with the full decision
 * context, assistant `<agent_draft>` replies are stripped for display and
 * parsed to back-fill the form, and the live draft autosaves to
 * saveAgentBuilderDraft. Create retires the conversation to archived
 * (record preserved, read-only, dropped from the drafts list) and jumps to
 * the new agent's detail screen.
 *
 * Mobile v1 divergence from web: the runtime's live model catalog is never
 * discovered, so the builder may preserve the user's chosen model but cannot
 * invent one (`lib/agent-builder` degrades models to null).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatMessage, ChatPendingTask } from "@multica/core/types";
import { runtimeDisplayLabel } from "@multica/core/runtimes";
import {
  EMPTY_AGENT_DRAFT,
  applyDraftRuntimeChange,
  fromStoredAgentDraft,
  storedAgentDraftsEqual,
  toStoredAgentDraft,
  type AgentDraft,
  type StoredAgentDraft,
} from "@multica/core/agents";
import { api, ApiError } from "@/data/api";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  chatKeys,
  chatMessagesOptions,
  pendingChatTaskOptions,
  taskMessagesOptions,
} from "@/data/queries/chat";
import { agentBuilderSessionListOptions, agentKeys } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { skillListOptions } from "@/data/queries/skills";
import { useCreateAgent } from "@/data/mutations/agents";
import { useChatSessionRealtime } from "@/data/realtime/use-chat-session-realtime";
import { invalidatePendingTask, seedAcceptedPendingTask } from "@/data/realtime/chat-ws-updaters";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatComposer } from "@/components/chat/chat-composer";
import { BuilderConfigPanel } from "@/components/agent/builder-config-panel";
import {
  buildBuilderCreateRequest,
  builderDisplayContent,
  encodeBuilderTurn,
  latestDraftPayload,
  mergeDraftFromAssistant,
} from "@/lib/agent-builder";
import { classifyAgentCreateError } from "@/lib/agent-create";
import { keyboardBehavior } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { Text } from "@/components/ui/text";
import { isPendingTaskActive } from "@/lib/chat-task-polling";

/** How long editing pauses before the configuration is written back. */
const AUTOSAVE_DELAY_MS = 800;

export function BuilderWorkspace({
  sessionId,
  startedRuntimeId,
}: {
  sessionId: string;
  /** Runtime this conversation was just started on. A conversation only joins
   *  the drafts list once it has a message, so for the first turn this is the
   *  only truthful answer to "where does it run". */
  startedRuntimeId: string;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  // ── Server state ────────────────────────────────────────────────────────
  const listQuery = useQuery(agentBuilderSessionListOptions(wsId));
  const sessions = listQuery.data ?? [];
  const listSettled = listQuery.isSuccess || listQuery.isError;
  const messagesQuery = useQuery(chatMessagesOptions(sessionId));
  const messages = messagesQuery.data ?? EMPTY_MESSAGES;
  const messagesLoading = messagesQuery.isLoading;
  const pendingTask = useQuery(pendingChatTaskOptions(sessionId)).data;
  const { data: liveTaskMessages = [] } = useQuery({
    ...taskMessagesOptions(pendingTask?.task_id),
    refetchInterval: isPendingTaskActive(pendingTask) ? 2_000 : false,
  });
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const { data: workspaceSkills = [] } = useQuery(skillListOptions(wsId));
  const createAgent = useCreateAgent();

  // The carrier's runtime — where this conversation actually executes. Only
  // the server knows it until the drafts list answers (MUL-5163).
  const session = sessions.find((row) => row.session_id === sessionId);
  const runtimeId = session?.runtime_id || startedRuntimeId;
  const selectedRuntime =
    runtimes.find((runtime) => runtime.id === runtimeId) ?? null;

  // The conversation named by the URL is gone (discarded here, deleted from
  // another tab): the transcript fetch answers with a 404. Read that rather
  // than "absent from the drafts list", because a session created a second
  // ago is legitimately missing from the list.
  const missing =
    messagesQuery.error instanceof ApiError &&
    messagesQuery.error.status === 404;

  useEffect(() => {
    if (!missing) return;
    if (wsSlug) router.back();
  }, [missing, wsSlug]);

  // ── Realtime ────────────────────────────────────────────────────────────
  useChatSessionRealtime(sessionId, () => {
    if (wsSlug) router.back();
  });

  const invalidateSessions = useCallback(() => {
    void qc.invalidateQueries({ queryKey: agentKeys.builderSessions(wsId) });
  }, [qc, wsId]);

  // ── Draft: restore the stored configuration, then autosave ──────────────
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_AGENT_DRAFT);
  const [restored, setRestored] = useState(false);
  const appliedMessageIdRef = useRef<string | null>(null);
  const savedRef = useRef<StoredAgentDraft | null>(null);
  const pendingSaveRef = useRef<StoredAgentDraft | null>(null);

  // Restore once the list answers. The stored draft carries no runtime —
  // the carrier owns it — so the runtime comes from the session row, or from
  // the URL for a brand-new conversation the list has not seen yet.
  useEffect(() => {
    if (!listSettled || restored) return;
    const stored = session?.draft ?? null;
    if (stored) {
      appliedMessageIdRef.current = stored.applied_message_id;
      savedRef.current = stored;
      setDraft(fromStoredAgentDraft(stored, runtimeId));
    } else if (runtimeId) {
      setDraft((current) =>
        current.runtimeId === runtimeId ? current : { ...current, runtimeId },
      );
    }
    setRestored(true);
    // The restore is one-shot per conversation; the session identity is
    // pinned by the props (the route is keyed on sessionId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listSettled, session?.session_id, runtimeId]);

  const save = useCallback(
    (next: StoredAgentDraft) => {
      savedRef.current = next;
      pendingSaveRef.current = null;
      void api
        .saveAgentBuilderDraft(sessionId, next)
        .catch(() => {
          // Best-effort: the next edit retries, and one lost write costs the
          // user nothing they can see (web use-builder-draft-sync).
          savedRef.current = null;
        })
        .finally(() => {
          // The drafts list shows the saved configuration's name (its title),
          // and the global staleTime keeps that cache fresh for a minute — so
          // an autosave must invalidate it or the setup screen would keep
          // showing the stale row (Untitled) after a back.
          invalidateSessions();
        });
    },
    [sessionId, invalidateSessions],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!sessionId || !restored) return;
    const next = toStoredAgentDraft(draft, appliedMessageIdRef.current);
    if (savedRef.current && storedAgentDraftsEqual(savedRef.current, next)) {
      return;
    }
    pendingSaveRef.current = next;
    const timer = setTimeout(() => save(next), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, restored, save, sessionId]);

  // Unmount is the deadline: route changes tear this down and the debounce
  // timer dies with it, so flush whatever edit is still pending.
  useEffect(
    () => () => {
      const pending = pendingSaveRef.current;
      if (pending) saveRef.current(pending);
    },
    [],
  );

  // ── Back-fill the form from the newest assistant <agent_draft> ──────────
  const skillIdSet = useMemo(
    () => new Set(workspaceSkills.map((skill) => skill.id)),
    [workspaceSkills],
  );
  const memberIdSet = useMemo(
    () => new Set(members.map((member) => member.user_id)),
    [members],
  );
  const draftRef = latestDraftPayload(messages);
  const latestDraftMessageId = draftRef?.messageId ?? null;

  // Gate on the APPLIED message id — the same id the autosave persists as
  // `applied_message_id`. That is what stops a restore from re-applying the
  // last reply over edits the user made after it (web builder-workspace.tsx):
  // re-entering the conversation restores the stored id, so the final draft
  // message is recognised as already reflected and never overwrites the
  // hand-edited form.
  useEffect(() => {
    if (!restored || !draftRef || !latestDraftMessageId) return;
    if (latestDraftMessageId === appliedMessageIdRef.current) return;
    appliedMessageIdRef.current = draftRef.messageId;
    setDraft((current) =>
      mergeDraftFromAssistant(current, draftRef.payload, {
        skills: skillIdSet,
        members: memberIdSet,
      }),
    );
    // `draftRef` is recreated by latestDraftPayload every render, but the
    // applied-id guard above makes those runs a no-op.
  }, [latestDraftMessageId, restored, sessionId, draftRef, memberIdSet, skillIdSet]);

  // ── Composer ────────────────────────────────────────────────────────────
  const [composer, setComposer] = useState("");
  const sending = !!pendingTask?.task_id;
  const [error, setError] = useState<string | null>(null);

  // Read through a ref so the encoder handed to the send callback stays
  // current without the callback depending on every catalog query.
  const encodeContext = useRef({
    draft,
    skills: workspaceSkills,
    members,
    runtime: selectedRuntime,
  });
  encodeContext.current = {
    draft,
    skills: workspaceSkills,
    members,
    runtime: selectedRuntime,
  };

  const handleSend = useCallback(
    async (content: string): Promise<void> => {
      const text = content.trim();
      if (!text || !sessionId || sending) return;
      setError(null);
      try {
        const encoded = encodeBuilderTurn(text, encodeContext.current);
        const result = await api.sendChatMessage(sessionId, encoded);
        const createdAt = new Date().toISOString();
        const seeded: ChatMessage = {
          id: result.message_id,
          chat_session_id: sessionId,
          role: "user",
          content: encoded,
          task_id: result.task_id,
          created_at: createdAt,
        };
        qc.setQueryData<ChatMessage[]>(chatKeys.messages(sessionId), (old) =>
          old ? [...old, seeded] : [seeded],
        );
        seedAcceptedPendingTask(qc, {
          chat_session_id: sessionId,
          task_id: result.task_id,
          created_at: createdAt,
          message_id: result.message_id,
          content: encoded,
          supports_queue: result.supports_queue,
          queued: result.queued,
        });
        setComposer("");
        void qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
        void qc.invalidateQueries({ queryKey: chatKeys.pendingTask(sessionId) });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : t("agents.new.ai.sendFailed"),
        );
        throw err; // MessageComposer restores the draft text on throw.
      }
      // The first turn is what makes a brand-new conversation listable.
      invalidateSessions();
    },
    [sessionId, sending, qc, invalidateSessions, t],
  );

  const handleStop = useCallback(() => {
    if (!pendingTask?.task_id || !sessionId) return;
    if (pendingTask.status === "queued") return;
    const taskId = pendingTask.task_id;
    qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), (old) =>
      old?.task_id === taskId ? {} : old,
    );
    void api
      .cancelTaskById(taskId)
      .catch(() => {})
      .finally(() => invalidatePendingTask(qc, sessionId));
  }, [pendingTask?.task_id, pendingTask?.status, sessionId, qc]);

  // Display: user side decodes the envelope, assistant side strips the
  // <agent_draft> block before it reaches the transcript.
  const displayMessages = useMemo(
    () =>
      messages.map((message) => ({
        ...message,
        content: builderDisplayContent(message.role, message.content),
      })) as ChatMessage[],
    [messages],
  );

  // ── Create / discard ────────────────────────────────────────────────────
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const createSubmit = useCallback(async () => {
    if (!sessionId || !draft.runtimeId) return;
    setCreating(true);
    setFormError(null);
    try {
      const created = await createAgent.mutateAsync(
        buildBuilderCreateRequest({ draft, runtimeId: draft.runtimeId }),
      );
      // Best-effort retirement: the agent is already committed, so a failure
      // here must never surface as a retryable create error.
      await api.setChatSessionArchived(sessionId, true).catch(() => {});
      qc.removeQueries({ queryKey: chatKeys.messages(sessionId) });
      qc.removeQueries({ queryKey: chatKeys.pendingTask(sessionId) });
      invalidateSessions();
      if (wsSlug) {
        router.replace(`/${wsSlug}/more/agents/${created.id}`);
      } else {
        router.back();
      }
    } catch (err) {
      const next = classifyAgentCreateError(
        err,
        t("agents.new.failedMessage"),
        t("agents.new.nameConflict"),
      );
      setFormError(
        next.nameError
          ? `${t("agents.new.nameConflict")} — ${next.nameError}`
          : next.formError,
      );
    } finally {
      setCreating(false);
    }
  }, [sessionId, draft, createAgent, qc, invalidateSessions, wsSlug, t]);

  const discardSubmit = useCallback(() => {
    if (!sessionId) return;
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
              .deleteChatSession(sessionId)
              .then(() => {
                qc.removeQueries({ queryKey: chatKeys.messages(sessionId) });
                qc.removeQueries({ queryKey: chatKeys.pendingTask(sessionId) });
                invalidateSessions();
                if (wsSlug) router.back();
              })
              .catch(() => setError(t("agents.new.ai.discardFailed")));
          },
        },
      ],
      { cancelable: true },
    );
  }, [sessionId, qc, invalidateSessions, wsSlug, t]);

  // ── Tabs ────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<"chat" | "config">("chat");
  // Badge the chat tab when a back-fill lands behind it.
  const [pendingApply, setPendingApply] = useState(0);
  const lastBadgedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = draftRef && latestDraftMessageId
      ? `${latestDraftMessageId}:${JSON.stringify(draftRef.payload)}`
      : null;
    if (!key || key === lastBadgedKeyRef.current) return;
    lastBadgedKeyRef.current = key;
    if (tab !== "config") setPendingApply((count) => count + 1);
  }, [latestDraftMessageId, draftRef, tab]);

  const canCreate =
    draft.name.trim().length > 0 && !!draft.runtimeId && !creating && !sending;

  return (
    <KeyboardAvoidingView
      behavior={keyboardBehavior}
      className="flex-1 bg-background"
    >
      {/* Toolbar: runtime chip + panel switcher + create/discard */}
      <View className="flex-row items-center gap-2 border-b border-border px-4 py-2.5">
        {selectedRuntime ? (
          <View className="flex-row items-center gap-1 rounded-full bg-secondary px-2.5 py-1">
            <Ionicons
              name="hardware-chip-outline"
              size={13}
              color={theme.mutedForeground}
            />
            <Text
              className="text-xs text-muted-foreground"
              numberOfLines={1}
            >
              {runtimeDisplayLabel(selectedRuntime)}
            </Text>
          </View>
        ) : null}
        <View className="flex-1 flex-row rounded-full bg-muted p-0.5">
          <TabButton
            label={t("agents.new.ai.chatTab")}
            active={tab === "chat"}
            badge={pendingApply > 0 ? pendingApply : null}
            onPress={() => {
              setPendingApply(0);
              setTab("chat");
            }}
          />
          <TabButton
            label={t("agents.new.ai.configTab")}
            active={tab === "config"}
            onPress={() => {
              setPendingApply(0);
              setTab("config");
            }}
          />
        </View>
        <Pressable
          onPress={() => void createSubmit()}
          disabled={!canCreate || creating}
          className={cn(
            "size-8 items-center justify-center rounded-md",
            canCreate ? "active:bg-secondary" : "opacity-40",
          )}
          accessibilityLabel={t("agents.new.create")}
        >
          {creating ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Ionicons
              name="checkmark"
              size={20}
              color={canCreate ? theme.primary : theme.mutedForeground}
            />
          )}
        </Pressable>
        <Pressable
          onPress={discardSubmit}
          accessibilityLabel={t("agents.new.ai.discard")}
          className="size-8 items-center justify-center rounded-md active:bg-secondary"
        >
          <Ionicons
            name="trash-outline"
            size={17}
            color={theme.mutedForeground}
          />
        </Pressable>
      </View>

      {tab === "chat" ? (
        <View className="flex-1 min-h-0">
          <ChatMessageList
            messages={displayMessages}
            loading={messagesLoading}
            hasSessions={true}
            onPickPrompt={(text) => setComposer(text)}
            pendingTask={pendingTask}
            liveTaskMessages={liveTaskMessages}
          />
          {error ? (
            <View className="mx-4 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
              <Text className="text-xs text-destructive">{error}</Text>
            </View>
          ) : null}
          <View className="border-t border-border" />
          <ChatComposer
            value={composer}
            onChangeText={setComposer}
            onSend={handleSend}
            onStop={handleStop}
            sending={sending}
            allowStop={pendingTask?.status !== "queued"}
          />
        </View>
      ) : (
        <View className="flex-1 min-h-0">
          <ScrollView
            className="flex-1"
            contentContainerClassName="px-4 py-4 pb-10"
            keyboardShouldPersistTaps="handled"
          >
            <BuilderConfigPanel
              draft={draft}
              onChange={setDraft}
              runtimes={runtimes}
              members={members}
              workspaceSkills={workspaceSkills}
              selectedRuntimeId={draft.runtimeId}
              currentUserId={currentUserId}
              formError={formError}
              onRuntimeSwitch={async (nextRuntime) => {
                if (!sessionId || nextRuntime.id === draft.runtimeId) return;
                setError(null);
                try {
                  const bound = await api.switchAgentBuilderRuntime(
                    sessionId,
                    { runtime_id: nextRuntime.id },
                  );
                  const nextId = bound.runtime_id || nextRuntime.id;
                  // Model ids are per-runtime; applyDraftRuntimeChange clears
                  // them so the new runtime resolves its own defaults.
                  setDraft((current) =>
                    applyDraftRuntimeChange(current, nextId),
                  );
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : t("agents.new.ai.runtimeSwitchFailed"),
                  );
                }
              }}
            />
            <View className="mt-4 gap-2">
              <Pressable
                onPress={() => void createSubmit()}
                disabled={!canCreate || creating}
                className={cn(
                  "items-center justify-center rounded-lg py-3",
                  canCreate ? "bg-primary active:opacity-90" : "bg-muted",
                )}
              >
                {creating ? (
                  <ActivityIndicator color={theme.background} />
                ) : (
                  <Text
                    className={cn(
                      "text-sm font-semibold",
                      canCreate
                        ? "text-primary-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {t("agents.new.create")}
                  </Text>
                )}
              </Pressable>
              {!canCreate && draft.name.trim().length === 0 ? (
                <Text className="text-center text-xs text-muted-foreground">
                  {t("agents.new.ai.nameRequiredHint")}
                </Text>
              ) : null}
              {!canCreate && draft.name.trim().length > 0 && !sending && !draft.runtimeId ? (
                <Text className="text-center text-xs text-muted-foreground">
                  {t("agents.new.ai.runtimeRequiredHint")}
                </Text>
              ) : null}
            </View>
          </ScrollView>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const EMPTY_MESSAGES: ChatMessage[] = [];

function TabButton({
  label,
  active,
  badge,
  onPress,
}: {
  label: string;
  active: boolean;
  badge?: number | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        "flex-1 flex-row items-center justify-center gap-1.5 rounded-full py-1.5",
        active && "bg-background",
      )}
    >
      <Text
        className={cn(
          "text-xs font-medium",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </Text>
      {badge ? (
        <View className="h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1">
          <Text className="text-[10px] font-semibold text-primary-foreground">
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}