/**
 * Agent edit route — reuses the manual create form in edit mode
 * (ManualAgentForm with the agent prop). The form seeds from the agent's
 * current fields, submits `buildUpdateAgentRequest` via PUT /api/agents/{id},
 * and pops back to the detail screen (whose list cache the mutation
 * invalidates). Header title comes from the workspace Stack registration
 * (more/agents/[id]/edit).
 *
 * `recordRead` gates the not-found branch (MYS-1908): the old
 * `if (isLoading) …; if (!agent)` said 「还没有智能体」 for a list read that had
 * merely failed, and offered no way to retry.
 *
 * `?focus=conversation_starters` is the chat empty state's "customize"
 * deep link: the form is long, so landing at its top and leaving the reader to
 * hunt for the starters block would make the link a worse answer than no link
 * at all. The form reports the block's offset and this screen scrolls it into
 * view once. The parameter is read on arrival and NOT stored, so a later
 * re-render (or a plain re-entry from the agents list) does not replay the
 * scroll somebody already got — the same consume-on-arrival rule web's
 * instructions tab follows.
 */
import { useCallback, useRef } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { CatalogStatus } from "@/components/catalog/catalog-status";
import { ManualAgentForm } from "@/components/agent/manual-agent-form";
import { agentListAllOptions } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { recordRead } from "@/lib/catalog-read";
import { keyboardBehavior } from "@/lib/keyboard";
import { FOCUS_CONVERSATION_STARTERS } from "@/lib/conversation-starters-mobile";

export default function EditAgentPage() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const agents = useQuery(agentListAllOptions(wsId));
  const agent = agents.data?.find((a) => a.id === id);
  const read = recordRead(agent, [agents]);

  const scrollRef = useRef<ScrollView>(null);
  // The scroll fires on the FIRST layout report only. Without this the block
  // would re-scroll on every re-layout (keyboard open/close, a row added),
  // yanking the viewport while the author is typing in it.
  const focusedRef = useRef(false);
  const wantsStartersFocus = focus === FOCUS_CONVERSATION_STARTERS;

  const handleStartersLayout = useCallback(
    (offsetY: number) => {
      if (!wantsStartersFocus || focusedRef.current) return;
      focusedRef.current = true;
      scrollRef.current?.scrollTo({ y: offsetY, animated: true });
    },
    [wantsStartersFocus],
  );

  if (agent) {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={keyboardBehavior}
      >
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="pb-10"
          keyboardShouldPersistTaps="handled"
        >
          <ManualAgentForm
            agent={agent}
            onFocusStartersLayout={handleStartersLayout}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <View className="flex-1 justify-center bg-background">
      <CatalogStatus
        state={read.isResolved ? "empty" : read.state}
        onRetry={read.retry}
        emptyMessage={t("agents.notFound")}
        layout="centered"
      />
    </View>
  );
}
