/**
 * Double-state row that lives inside `IssueHeaderCard`. Pushes the
 * `issue/[id]/runs` formSheet route — the Stack-header
 * `<AgentHeaderBadge>` pushes the same route.
 *
 *   ≥1 RUNNING task       → [agent avatars] (pulse) Working           ›
 *   0 running, ≥1 queued  → [dim avatars]    Queued · N agents        ›
 *   0 active, ≥1 past     → 🕓 Runs · N                                ›
 *   never run             → null (zero space)
 *
 * The running/queued split is not cosmetic. `GET /api/issues/:id/active-task`
 * returns `queued`, `dispatched` and `waiting_local_directory` alongside
 * `running` (server/pkg/db/queries/agent.sql:1647), so reading a non-empty
 * list as "an agent is working" told the reader work was in flight while the
 * task had not started. Web keeps the two apart in
 * `issue-agent-header-chip.tsx` (`is_working` / `is_queued`); the decision now
 * lives in `lib/issue-work-state.ts` so all three detail surfaces share it.
 *
 * This row is the "discovery" surface (visible only when timeline isn't
 * scrolled). The badge is the "ambient" surface (always visible during
 * active tasks). One route, two entry points.
 */
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { AvatarStack, type StackActor } from "@/components/ui/avatar-stack";
import { PulseDot } from "@/components/ui/pulse-dot";
import {
  issueActiveTasksOptions,
  issueTasksOptions,
} from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { countLabelKey } from "@/lib/actor-profile";
import { summarizeIssueWork } from "@/lib/issue-work-state";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  issueId: string;
}

export function AgentActivityRow({ issueId }: Props) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const { colorScheme } = useColorScheme();
  const { t } = useTranslation();
  const mutedFg = THEME[colorScheme].mutedForeground;

  const { data: activeTasks = [] } = useQuery(
    issueActiveTasksOptions(wsId, issueId),
  );
  const { data: allTasks = [] } = useQuery(issueTasksOptions(wsId, issueId));

  // Running vs. waiting-to-start, the same split web's header chip makes. A
  // queued task is real work in line, but saying it is "working" is a claim
  // about the present that is not true yet.
  const work = useMemo(() => summarizeIssueWork(activeTasks), [activeTasks]);
  // "Past" = tasks not currently active. The /task-runs endpoint returns the
  // full list, so we filter rather than fetching a separate past-only query.
  const pastCount = useMemo(
    () =>
      allTasks.filter(
        (t) =>
          t.status === "completed" ||
          t.status === "failed" ||
          t.status === "cancelled",
      ).length,
    [allTasks],
  );

  if (work.state === "idle" && pastCount === 0) {
    return null;
  }

  return (
    <Pressable
      onPress={() => {
        if (!wsSlug) return;
        router.push({
          pathname: "/[workspace]/issue/[id]/runs",
          params: { workspace: wsSlug, id: issueId },
        });
      }}
      className="flex-row items-center gap-2 -mx-2 px-2 py-2 rounded-lg active:bg-secondary"
    >
      {work.state === "idle" ? (
        <IdleContent count={pastCount} mutedFg={mutedFg} t={t} />
      ) : (
        <ActiveContent
          actors={work.agentIds.map<StackActor>((id) => ({
            type: "agent",
            id,
          }))}
          running={work.state === "running"}
          mutedFg={mutedFg}
          t={t}
        />
      )}
      <Ionicons name="chevron-forward" size={16} color={mutedFg} />
    </Pressable>
  );
}

function ActiveContent({
  actors,
  running,
  mutedFg,
  t,
}: {
  actors: StackActor[];
  running: boolean;
  mutedFg: string;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  // Motion is reserved for work genuinely in flight (web's chip does the same:
  // the border beam only runs while something is `running`). A half-opacity
  // stack and a muted word say "waiting" without claiming otherwise.
  return (
    <View className="flex-1 flex-row items-center gap-2">
      <View style={running ? undefined : { opacity: 0.5 }}>
        <AvatarStack actors={actors} max={3} size={24} />
      </View>
      {running ? <PulseDot /> : null}
      <Text
        className={
          running
            ? "text-body font-medium text-foreground"
            : "text-body font-medium text-muted-foreground"
        }
      >
        {running
          ? t("issue.working")
          : t(countLabelKey("issue.queuedAgents", actors.length), {
              count: actors.length,
            })}
      </Text>
    </View>
  );
}

function IdleContent({
  count,
  mutedFg,
  t,
}: {
  count: number;
  mutedFg: string;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <View className="flex-1 flex-row items-center gap-2">
      <Ionicons name="time-outline" size={16} color={mutedFg} />
      <Text className="text-body text-foreground">{t("issue.runsCount", { count })}</Text>
    </View>
  );
}
