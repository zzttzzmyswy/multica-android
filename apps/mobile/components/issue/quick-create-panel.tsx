/**
 * Agent-mode body of the new-issue modal (`new-issue.tsx`). Renders the
 * natural-language prompt field, the actor (agent/squad) chip that opens
 * the `new-issue-picker/agent` formSheet, and the shared attribute row
 * filtered to project / priority / due-date.
 *
 * Mirrors web's AgentCreatePanel
 * (packages/views/modals/quick-create-issue.tsx): the prompt describes the
 * task in plain language (no handwritten title), the picked actor turns it
 * into a real issue via `POST /api/issues/quick-create`, and the issue
 * surfaces later as an inbox notification. Deliberately simpler than web —
 * no attachment upload, no CLI-version gate, no persisted last-actor
 * preference.
 *
 * The prompt is a controlled input owned by `new-issue.tsx` so a mode
 * switch manual ↔ agent never loses either draft; the actor lives in
 * `useNewIssueDraftStore` (same cross-route channel as assignee).
 */
import { useEffect, useMemo } from "react";
import { TextInput, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { AttributeChip } from "@/components/issue/attribute-chip";
import {
  CreateFormAttributeRow,
  type NewIssuePickerField,
} from "@/components/issue/create-form-attribute-row";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { MOBILE_PLACEHOLDER_COLOR } from "@/components/ui/input-tokens";
import { agentListOptions } from "@/data/queries/agents";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { useTranslation } from "@/lib/i18n/react";

/** Stable filter array — module-level so CreateFormAttributeRow keeps its
 *  render list identity across renders. */
const AGENT_FIELDS: NewIssuePickerField[] = ["project", "priority", "due-date"];

interface Props {
  prompt: string;
  onPromptChange: (next: string) => void;
  disabled?: boolean;
}

export function QuickCreatePanel({ prompt, onPromptChange, disabled }: Props) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const actor = useNewIssueDraftStore((s) => s.agentActor);
  const setActor = useNewIssueDraftStore((s) => s.setAgentActor);
  const { getName } = useActorLookup();
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  // Visible = non-archived AND runtime-bound. Same bar the agent picker
  // rows assume when deciding whether an actor can actually take the task.
  const visibleAgents = useMemo(
    () => agents.filter((a) => !a.archived_at && isAgentRuntimeBound(a)),
    [agents],
  );

  // Default actor = first visible agent (mirrors web's seedActor final
  // fallback). Only seeds while nothing is selected, so a pick survives
  // mode switches inside the modal; re-seeds if the lists resolve after
  // the first (empty) render.
  useEffect(() => {
    if (actor || visibleAgents.length === 0) return;
    setActor({ type: "agent", id: visibleAgents[0].id });
  }, [actor, visibleAgents, setActor]);

  const actorLabel = actor
    ? getName(actor.type, actor.id)
    : t("newIssue.agentSelectAgent");

  const openActorPicker = () => {
    if (!wsSlug) return;
    router.push({
      pathname: "/[workspace]/new-issue-picker/agent",
      params: { workspace: wsSlug },
    });
  };

  return (
    <View className="gap-4">
      <TextInput
        value={prompt}
        onChangeText={onPromptChange}
        placeholder={t("newIssue.agentPlaceholder")}
        placeholderTextColor={MOBILE_PLACEHOLDER_COLOR}
        className="min-h-24 py-2 text-base text-foreground"
        multiline
        textAlignVertical="top"
        editable={!disabled}
      />
      {/* Actor chip — taps into the agent/squad formSheet picker. */}
      <View className="flex-row flex-wrap items-center gap-2">
        <AttributeChip
          icon={
            actor ? (
              <ActorAvatar type={actor.type} id={actor.id} size={16} />
            ) : (
              <Ionicons
                name="hardware-chip-outline"
                size={16}
                color="#a1a1aa"
              />
            )
          }
          label={actor ? actorLabel : t("newIssue.agentSelectAgent")}
          variant={actor ? "filled" : "dimmed"}
          onPress={openActorPicker}
          accessibilityLabel={t("a11y.newIssueAgentPicker")}
        />
      </View>
      <CreateFormAttributeRow fields={AGENT_FIELDS} />
    </View>
  );
}