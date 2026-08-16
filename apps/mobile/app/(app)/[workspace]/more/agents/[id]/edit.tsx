/**
 * Agent edit route — reuses the manual create form in edit mode
 * (ManualAgentForm with the agent prop). The form seeds from the agent's
 * current fields, submits `buildUpdateAgentRequest` via PUT /api/agents/{id},
 * and pops back to the detail screen (whose list cache the mutation
 * invalidates). Header title comes from the workspace Stack registration
 * (more/agents/[id]/edit).
 */
import { ActivityIndicator, KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { ManualAgentForm } from "@/components/agent/manual-agent-form";
import { agentListAllOptions } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { keyboardBehavior } from "@/lib/keyboard";

export default function EditAgentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const agents = useQuery(agentListAllOptions(wsId));
  const agent = agents.data?.find((a) => a.id === id);

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

  if (agents.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center px-6 bg-background">
      <Text className="text-sm text-muted-foreground text-center">
        {t("agents.emptyTitle")}
      </Text>
    </View>
  );
}