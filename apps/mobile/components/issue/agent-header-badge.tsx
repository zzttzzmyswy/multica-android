/**
 * Ambient status badge for the issue detail Stack header (right side).
 * Renders only when ≥1 agent task is active on this issue; otherwise null.
 *
 * The badge distinguishes running from waiting-to-start, mirroring web's
 * `issue-agent-header-chip.tsx`: the pulse runs only while something is
 * genuinely `running`, and the accessibility label says which of the two
 * states the issue is actually in. `GET /api/issues/:id/active-task` returns
 * `queued` / `dispatched` / `waiting_local_directory` in the same list as
 * `running`, so a non-empty list alone does not mean an agent is producing
 * output — see `lib/issue-work-state.ts`.
 *
 * Why this exists: the in-card `<AgentActivityRow>` is the first-time-
 * discovery surface (full "Working" text + larger avatars), but it scrolls
 * away with the timeline. Agent tasks run for minutes to tens of minutes;
 * users actively scroll during that window to read past comments. The
 * "is anything still working" signal needs a consistent location — see
 * Apple HIG "Progress Indicators" + the agent-UX "ambient status badge"
 * pattern (https://www.aiuxdesign.guide/patterns/agent-status-monitoring).
 *
 * Tap pushes the `issue/[id]/runs` formSheet route — the in-card
 * AgentActivityRow does the same. One route, two entry points, no
 * duplicate sheet state.
 */
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { AvatarStack, type StackActor } from "@/components/ui/avatar-stack";
import { PulseDot } from "@/components/ui/pulse-dot";
import { issueActiveTasksOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { countLabelKey } from "@/lib/actor-profile";
import { summarizeIssueWork } from "@/lib/issue-work-state";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  issueId: string;
}

export function AgentHeaderBadge({ issueId }: Props) {
  const { t } = useTranslation();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { data: active = [] } = useQuery(
    issueActiveTasksOptions(wsId, issueId),
  );

  const work = useMemo(() => summarizeIssueWork(active), [active]);

  if (work.state === "idle") return null;

  const running = work.state === "running";
  const actors = work.agentIds.map<StackActor>((id) => ({ type: "agent", id }));

  return (
    <Pressable
      onPress={() => {
        if (!wsSlug) return;
        router.push({
          pathname: "/[workspace]/issue/[id]/runs",
          params: { workspace: wsSlug, id: issueId },
        });
      }}
      hitSlop={8}
      accessibilityLabel={
        running
          ? t("a11y.agentWorking")
          : t(countLabelKey("a11y.agentQueued", actors.length), {
              count: actors.length,
            })
      }
      className="flex-row items-center gap-1.5 px-2 py-1 active:opacity-60"
    >
      <View style={running ? undefined : { opacity: 0.5 }}>
        <AvatarStack actors={actors} max={2} size={20} />
      </View>
      {running ? <PulseDot size={6} /> : null}
    </Pressable>
  );
}
