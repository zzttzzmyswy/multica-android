/**
 * Manual agent-create route — one vertical scrolling form (mirrors
 * more/autopilots/new.tsx layout). Header title comes from the workspace
 * Stack registration (more/agents/new/manual); duplicate mode overrides it
 * with "Duplicate <name>" via setOptions, mirroring web's
 * `creation_studio.duplicate_title`.
 *
 * `?duplicate=<id>` seeds the same form from an existing agent instead of
 * starting empty — after seeding it is the exact same screen with the same
 * submit path (web parity: ManualCreateAgentPage). A stale parameter that
 * resolves to no agent falls back to a blank create.
 */
import { useLayoutEffect } from "react";
import { KeyboardAvoidingView, ScrollView } from "react-native";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ManualAgentForm } from "@/components/agent/manual-agent-form";
import { agentListOptions } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { keyboardBehavior } from "@/lib/keyboard";

export default function NewManualAgentPage() {
  const { duplicate } = useLocalSearchParams<{ duplicate?: string }>();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const agents = useQuery(agentListOptions(wsId));
  const duplicateId = typeof duplicate === "string" && duplicate ? duplicate : null;
  const duplicateSource = duplicateId
    ? (agents.data ?? []).find((a) => a.id === duplicateId) ?? null
    : null;

  useLayoutEffect(() => {
    if (!duplicateSource) return;
    navigation.setOptions({
      title: t("agents.duplicate.title", { name: duplicateSource.name }),
    });
  }, [duplicateSource, t]);

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
        <ManualAgentForm duplicateSource={duplicateSource} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}