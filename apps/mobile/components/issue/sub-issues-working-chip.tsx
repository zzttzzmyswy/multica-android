/**
 * Aggregate "N agents working" chip for the sub-issues header on issue detail
 * — mobile port of web's `SubIssuesAgentWorkingChip`
 * (`packages/views/issues/components/sub-issues-agent-working-chip.tsx`),
 * which web renders at `issue-detail.tsx:2801`, immediately after the
 * sub-issue progress pill.
 *
 * The per-row `IssueAgentActivityIndicator` answers "which sub-issue is being
 * worked on"; this chip answers "how many agents are on this parent's children
 * right now" without scanning the rows — and it keeps that signal visible
 * while the list is folded.
 *
 * It reads the same projection as the Issues header chip, narrowed with
 * `parent`. That is deliberate, and it is web's stated reason too: a header
 * count is a claim about a scope, so the server owns both the scope and the
 * arithmetic. Deriving it here from the workspace task snapshot would put a
 * second definition of "working" in the client, and the count and the roster
 * would each have to re-derive it.
 *
 * Non-interactive at rest: on web the chip is a HoverCard trigger whose whole
 * content is the hover body, so tapping it does nothing. A phone has no hover,
 * so here a TAP opens the roster sheet — the one interaction that has to
 * differ. The chip owns no toggle of its own; the sheet is the only action.
 *
 * Renders nothing when the projection resolved to nobody: web returns null, so
 * an idle parent shows no chrome rather than a "0" that reads as a control.
 * An UNRESOLVED projection also renders nothing — web's early return is on
 * `agents.length === 0` and its `data = []` default, which is the same shape.
 */
import { useState } from "react";
import { Pressable } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { AvatarStack, type StackActor } from "@/components/ui/avatar-stack";
import { PickerSheet } from "./pickers/picker-sheet";
import { WorkingAgentsRoster } from "./working-agents-roster";
import { subIssuesWorkingAgentsOptions } from "@/data/queries/working-agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";
import { countLabelKey } from "@/lib/actor-profile";

const STACK_SIZE = 16;

export function SubIssuesWorkingChip({
  parentIssueId,
}: {
  /** The parent issue's id. Must be the UUID from the issue record, never a
   *  route param — the endpoint answers 400 for a non-UUID (verified against
   *  the deployment). */
  parentIssueId: string;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const [rosterOpen, setRosterOpen] = useState(false);

  const { data: agents } = useQuery(
    subIssuesWorkingAgentsOptions(wsId, parentIssueId),
  );

  // No agents on this parent's children right now → no chrome (web returns
  // null). Includes the unresolved read, so the header never flashes a control
  // that the roster would then contradict.
  if (!agents || agents.length === 0) return null;

  const agentIds = agents.map((agent) => agent.id);
  const label = t(countLabelKey("issue.agentsWorking", agentIds.length), {
    count: agentIds.length,
  });

  return (
    <>
      <Pressable
        onPress={() => setRosterOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={t("issue.agentsWorkingRosterHint")}
        className="shrink-0 flex-row items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5"
      >
        <AvatarStack
          actors={agentIds.map<StackActor>((id) => ({ type: "agent", id }))}
          max={3}
          size={STACK_SIZE}
          // The stack paints the host surface between overlapping avatars; on
          // this chip that is the muted pill, not the page background.
          ringClassName="bg-muted"
        />
        <Text className="text-micro font-medium text-foreground tabular-nums">
          {label}
        </Text>
      </Pressable>
      <PickerSheet
        title={t("issue.agentsWorkingSheetTitle")}
        visible={rosterOpen}
        onClose={() => setRosterOpen(false)}
      >
        <WorkingAgentsRoster agents={agents} />
      </PickerSheet>
    </>
  );
}
