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
 */
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

export default function EditAgentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const agents = useQuery(agentListAllOptions(wsId));
  const agent = agents.data?.find((a) => a.id === id);
  const read = recordRead(agent, [agents]);

  if (agent) {
    return (
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={keyboardBehavior}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="pb-10"
          keyboardShouldPersistTaps="handled"
        >
          <ManualAgentForm agent={agent} />
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