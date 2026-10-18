/**
 * Agent-mode body of the new-issue modal (`new-issue.tsx`). Renders the
 * natural-language prompt field, the actor (agent/squad) chip that opens
 * the `new-issue-picker/agent` formSheet, and the shared attribute row
 * filtered to the quick-create settings (project / priority / due-date or
 * whatever Settings → Issue keeps visible; hidden fields live in the ⋯).
 *
 * Mirrors web's AgentCreatePanel
 * (packages/views/modals/quick-create-issue.tsx): the prompt describes the
 * task in plain language (no handwritten title), the picked actor turns it
 * into a real issue via `POST /api/issues/quick-create`, and the issue
 * surfaces later as an inbox notification.
 *
 * The prompt is the SAME `DescriptionField` the manual tab uses, for the same
 * reason web's agent panel uses the same editor as its advanced form: the
 * prompt is where "fix this screenshot / read this log" lives, so attaching
 * the file IS part of describing the task, and `POST /api/issues/quick-create`
 * has always accepted the `attachment_ids` that ride along. It used to be a
 * bare `TextInput` here, so the two tabs of one modal disagreed about whether
 * a file could be sent. Still deliberately simpler than web in two ways that
 * cost no capability: no CLI-version gate, no persisted last-actor preference.
 *
 * The prompt input lives in `new-issue.tsx` (second `useMentionInput`
 * instance) so a mode switch manual ↔ agent never loses either draft, and so
 * the @ suggestion bar — which has to float above the keyboard, outside the
 * scroll view — is rendered by the screen for both modes. Uploaded attachment
 * ids bubble up through `onAttachmentUploaded`; the in-flight flag through
 * `onUploadingChange`, which is what keeps submit from firing while a picked
 * file is still uploading (same gate manual mode uses).
 */
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { AttributeChip } from "@/components/issue/attribute-chip";
import { CreateFormAttributeRow } from "@/components/issue/create-form-attribute-row";
import { DescriptionField } from "@/components/issue/description-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { agentListOptions } from "@/data/queries/agents";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import { selectedActorLabel } from "@/lib/actor-name-state";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import type { UseMentionInputReturn } from "@/lib/use-mention-input";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  /** Live prompt input, owned by `new-issue.tsx` (see the header). */
  promptInput: UseMentionInputReturn;
  /** Reports a freshly uploaded attachment id for `attachment_ids`. */
  onAttachmentUploaded: (id: string) => void;
  /** Mirrors the in-flight upload flag so the screen can hold submit. */
  onUploadingChange: (uploading: boolean) => void;
  disabled?: boolean;
}

export function QuickCreatePanel({
  promptInput,
  onAttachmentUploaded,
  onUploadingChange,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const actor = useNewIssueDraftStore((s) => s.agentActor);
  const setActor = useNewIssueDraftStore((s) => s.setAgentActor);
  const { resolveActorName } = useActorLookup();
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

  // ECHO: `actor` is seeded locally (first runtime-bound agent) and then
  // replaced by whatever the user picks, so it is never a read result. The
  // 「选择智能体」 placeholder is what an EMPTY selection says — an actor that IS
  // selected must not borrow it, or the panel would look unconfigured right
  // after being configured (MYS-2227).
  const actorLabel = actor
    ? selectedActorLabel({
        state: resolveActorName(actor.type, actor.id),
        type: actor.type,
        // NOT `newIssue.agentSelectAgent` — that is what an EMPTY selection
        // says, and borrowing it here would make a configured panel look
        // unconfigured. The type's own noun is the right word for a
        // set-but-unread actor; this argument is the last-resort override for
        // a type this build does not recognise.
        fallback: t("picker.agent"),
      })
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
      <DescriptionField
        description={promptInput}
        disabled={!!disabled}
        placeholder={t("newIssue.agentPlaceholder")}
        onAttachmentUploaded={onAttachmentUploaded}
        onUploadingChange={onUploadingChange}
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
      <CreateFormAttributeRow mode="agent" />
    </View>
  );
}
