/**
 * "Environments" on the issue page — the servers and desktop apps this issue's
 * runs left running (MYS-2980). Mirrors web's
 * `packages/views/issues/components/issue-environments-section.tsx`.
 *
 * Why this exists on the phone: an agent run starts the project's services and
 * leaves them running. Web's issue sidebar lists them, so a reader can open the
 * preview, read a log, restart a crashed service, or start another one. Mobile
 * had no surface at all — a phone reader could not tell the issue had anything
 * running, let alone act on it. That is the gap this closes.
 *
 * Deliberate divergences from web, each noted at its site:
 *   - Rows live in the scrolling header rather than a fixed sidebar, so they
 *     sit beside `PullRequestList` / `DeliverablesSection`.
 *   - The start menu is a `PickerSheet`, not a nested dropdown: a phone has no
 *     submenu affordance, and web's machine → environment → agent nesting is
 *     three levels deep.
 *   - An app row offers no "switch to window": that is a Desktop-only bridge
 *     (`packages/views/platform/environment-focus.ts`) with no mobile
 *     equivalent. The row still names the hint so the reader knows where to go.
 *   - Row actions are a long-press menu plus inline buttons, because a phone
 *     has no hover gutter to reveal them.
 */
import { useMemo, useState } from "react";
import { Alert, Linking, Modal, Pressable, ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "@tanstack/react-query";
import type {
  Agent,
  DeclaredEnvironment,
  IssueEnvironment,
  IssueEnvironmentActionRecord,
  IssueEnvironmentConfig,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActionSheet } from "@/lib/action-sheet";
import { issueEnvironmentsOptions, issueTasksOptions } from "@/data/queries/issues";
import { runtimeListOptions } from "@/data/queries/runtimes";
import { agentListOptions } from "@/data/queries/agents";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useActorLookup } from "@/data/use-actor-name";
import {
  useControlIssueEnvironment,
  useCreateComment,
  type IssueEnvironmentControl,
} from "@/data/mutations/issues";
import { buildRuntimeMachines } from "@/lib/runtime-machines";
import { useTimeAgo } from "@/lib/time-ago";
import { useTranslation } from "@/lib/i18n/react";
import { useThemePalette } from "@/lib/appearance-a11y-runtime";
import {
  declaredState,
  environmentMeta,
  environmentTitle,
  groupByMachine,
  isLive,
  isPinnedCrash,
  pendingAction,
  preparingRun,
  recentFailure,
  rowAccess,
  rowCapabilities,
  runOrdinals,
  sortRowItems,
  type EnvironmentMeta,
  type EnvironmentRowItem,
  type EnvironmentRowState,
} from "@/lib/issue-environments";
import { EnvironmentLogSheet } from "./environment-log-sheet";

/** The tone each row state paints its icon and status text. Mirrors web's
 *  `STATE_TONE` (`issue-environments-section.tsx:88`). */
const STATE_TONE: Record<EnvironmentRowState, string> = {
  starting: "text-amber-600 dark:text-amber-500",
  running: "text-emerald-600 dark:text-emerald-400",
  unreachable: "text-amber-600 dark:text-amber-500",
  exited: "text-destructive",
  stopped: "text-muted-foreground",
  stopping: "text-muted-foreground",
};

/** Web's `SETTLE` window for the "asked an agent" row: the comment has been
 *  posted, the run may not exist yet. Module-level so the row survives the
 *  section re-rendering (web does the same with `requestedStartComments`). */
const requestedStartComments = new Map<string, Set<string>>();

export function IssueEnvironmentsSection({ issueId }: { issueId: string }) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const timeAgo = useTimeAgo();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { getName } = useActorLookup();
  const [open, setOpen] = useState(true);
  const [showEnded, setShowEnded] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [dismissedStarts, setDismissedStarts] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [justRequested, setJustRequested] = useState<string | null>(null);
  const [requested, setRequested] = useState<ReadonlySet<string>>(
    () => requestedStartComments.get(issueId) ?? new Set(),
  );

  const { data, isLoading } = useQuery(issueEnvironmentsOptions(wsId, issueId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const { data: tasks = [] } = useQuery(issueTasksOptions(wsId, issueId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const control = useControlIssueEnvironment(issueId);
  const createComment = useCreateComment(issueId);

  const now = Date.now();
  const envs = data?.environments ?? [];
  const configs = data?.configs ?? [];
  const pendingStarts = data?.pending_starts ?? [];
  const failedStarts = data?.failed_starts ?? [];

  // Machine lookup. `buildRuntimeMachines` is the same grouping the runtimes
  // screen uses, so a row's machine reads identically in both places. A phone
  // never runs the daemon, so `localDaemonId` stays unset and `isCurrent` can
  // only be true for a runtime the viewer owns on a host matching no local
  // name — in practice false, which is why `localhostHint` always shows.
  const machineByRuntime = useMemo(() => {
    const machines = buildRuntimeMachines(runtimes, { now });
    const byRuntime = new Map<string, { machineId: string; title: string; isCurrent: boolean }>();
    for (const machine of machines) {
      for (const runtime of machine.runtimes) {
        byRuntime.set(runtime.id, {
          machineId: machine.id,
          title: machine.title,
          isCurrent: machine.isCurrent,
        });
      }
    }
    return byRuntime;
  }, [runtimes, now]);
  const runtimeOnline = useMemo(
    () => new Map(runtimes.map((runtime) => [runtime.id, runtime.status === "online"])),
    [runtimes],
  );
  const ordinals = useMemo(() => runOrdinals(tasks), [tasks]);

  // An unknown runtime is one this member cannot see, or one this client has no
  // row for; only a KNOWN runtime can read as offline. Marking the unknown case
  // offline would claim a fact nobody established.
  const isOffline = (runtimeId: string | null) => !!runtimeId && runtimeOnline.get(runtimeId) === false;
  const machineOf = (runtimeId: string | null) =>
    runtimeId ? (machineByRuntime.get(runtimeId) ?? null) : null;

  const live = envs.filter(isLive);
  const pinned = envs.filter((env) => isPinnedCrash(env, envs, now));
  const ended = envs.filter((env) => !isLive(env) && !pinned.includes(env));
  const running = live.filter((env) => env.state === "running").length;

  const preparing = preparingRun(tasks, requested);
  const preparingShown =
    preparing && !envs.some((env) => env.task_id === preparing.id && isLive(env));
  const preparingAgentName = preparing
    ? getName("agent", preparing.agent_id)
    : justRequested;

  const activeAgents = agents.filter((agent) => !agent.archived_at);

  const runLabel = (taskId: string | null): string | null => {
    const ordinal = taskId ? ordinals.get(taskId) : undefined;
    if (!ordinal) return null;
    return ordinal === 1
      ? t("environments.runFirst")
      : t("environments.runNth", { count: ordinal });
  };

  const actorName = (record: IssueEnvironmentActionRecord): string =>
    record.actor_id && (record.actor_type === "member" || record.actor_type === "agent")
      ? getName(record.actor_type, record.actor_id)
      : t("environments.someone");

  // A start is settled once the environment it asked for has come up since,
  // however it got there — otherwise retrying a start that actually worked
  // leaves a stale failure row behind.
  const startedSince = (start: IssueEnvironmentActionRecord) =>
    live.some(
      (env) =>
        env.source === "config" &&
        env.runtime_id === start.runtime_id &&
        env.name === start.name &&
        (env.repo === "" || env.repo === start.repo) &&
        env.started_at >= start.created_at,
    );
  const shownStarts = pendingStarts.filter((start) => !startedSince(start));
  const shownFailures = failedStarts.filter(
    (start) => !startedSince(start) && !dismissedStarts.has(start.id),
  );

  const mainItems: EnvironmentRowItem[] = sortRowItems([
    ...[...live, ...pinned].map(
      (env) => ({ kind: "env" as const, id: env.id, env }),
    ),
    ...shownStarts.map((start) => ({ kind: "start" as const, id: start.id, start })),
    ...shownFailures.map((start) => ({ kind: "failed" as const, id: start.id, start })),
  ]);

  const runControl = (action: IssueEnvironmentControl) => {
    control.mutate(action, {
      onError: (error) => {
        const verb = t(
          action.action === "stop"
            ? "environments.actionStop"
            : action.action === "restart"
              ? "environments.actionRestart"
              : "environments.actionStart",
        );
        Alert.alert(
          t("environments.actionFailedGeneric", { action: verb }),
          error instanceof Error ? error.message : undefined,
        );
      },
    });
  };

  const askAgent = (agent: Agent) => {
    const mention = `[@${agent.name.replace(/[[\]]/g, "")}](mention://agent/${agent.id})`;
    setJustRequested(agent.name);
    createComment.mutate(
      {
        content: `${mention} ${t("environments.startMenu.agentInstruction")}`,
      },
      {
        onSuccess: (comment) => {
          const ids = new Set(requestedStartComments.get(issueId) ?? []);
          ids.add(comment.id);
          requestedStartComments.set(issueId, ids);
          setRequested(ids);
        },
        onError: (error) =>
          Alert.alert(
            t("environments.startMenu.askFailed"),
            error instanceof Error ? error.message : undefined,
          ),
        onSettled: () => setJustRequested(null),
      },
    );
  };

  const stateOf = (config: IssueEnvironmentConfig, declared: DeclaredEnvironment) =>
    declaredState(config, declared, live, pendingStarts);

  const declaringConfig = (start: IssueEnvironmentActionRecord) => {
    for (const config of configs) {
      if (config.runtime_id !== start.runtime_id) continue;
      const declared = config.environments.find(
        (env) => env.repo === start.repo && env.name === start.name,
      );
      if (declared) return { config, declared };
    }
    return null;
  };

  // Whether there is anything concrete to start. `configs.length` is NOT it:
  // the server reports one config per machine that ran the issue, and on this
  // deployment most declare no environments at all (verified live — MYS-2973
  // answers two configs, both with `environments: []`). Gating on the config
  // COUNT put an empty header with a dead "+" on nearly every issue that ever
  // ran, which is exactly the permanent no-op row this section must avoid.
  //
  // So the gate is a declared environment on a machine the viewer may control.
  // A machine they may not control is the same dead end — the server refuses
  // the start — and offering the entry anyway would be a button whose only
  // outcome is a 403.
  const startable = configs.some(
    (config) => config.can_control && config.environments.length > 0,
  );

  // Nothing to show: no live row, no crash pinned, nothing in flight, nothing
  // ended, and nothing that could be started. Rendering an empty section here
  // would put a permanent no-op row on every issue that never ran a service.
  const hasAnything =
    live.length > 0 ||
    pinned.length > 0 ||
    shownStarts.length > 0 ||
    shownFailures.length > 0 ||
    ended.length > 0 ||
    startable ||
    preparingShown ||
    justRequested !== null;
  if (!hasAnything) return null;
  if (!open) {
    // Collapsed still shows the header, so a reader can re-open it.
  }

  const groupOf = (items: readonly EnvironmentRowItem[]) =>
    groupByMachine(items, {
      machineOf: (id) => machineOf(id),
      isOffline,
    });

  const accessFor = (runtimeId: string | null) =>
    rowAccess({ machine: machineOf(runtimeId), offline: isOffline(runtimeId), knowsLocal: false });

  const renderEnv = (env: IssueEnvironment) => (
    <EnvironmentRow
      key={env.id}
      issueId={issueId}
      env={env}
      access={accessFor(env.runtime_id)}
      pinned={pinned.includes(env)}
      runLabel={runLabel}
      actorName={actorName}
      agentName={(id) => getName("agent", id)}
      timeAgo={timeAgo}
      onControl={runControl}
    />
  );

  const renderStart = (start: IssueEnvironmentActionRecord) => {
    const declared = declaringConfig(start)?.declared;
    return (
      <View key={start.id} className="flex-row items-start gap-2 rounded-md px-1 py-2">
        <Ionicons
          name="server-outline"
          size={14}
          color={theme.warning}
          style={{ marginTop: 1 }}
        />
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 min-w-0 text-label font-medium text-foreground" numberOfLines={1}>
              {declared?.label || start.name}
            </Text>
            <Text className="shrink-0 text-caption text-muted-foreground">
              {t("environments.state.starting")}
            </Text>
          </View>
          <Text className="mt-0.5 text-caption text-muted-foreground" numberOfLines={1}>
            {[t("environments.startedBy", { name: actorName(start) }), t("environments.waitingReady")].join(" · ")}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View className="border-t border-border px-4 pt-2 pb-2">
      <View className="flex-row items-center gap-1.5 py-1">
        <Pressable
          onPress={() => setOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={t("environments.a11ySection", {
            count: live.length + pinned.length,
          })}
          className="flex-1 min-w-0 flex-row items-center gap-1.5 py-1 active:opacity-70"
        >
          <Ionicons
            name={open ? "chevron-down" : "chevron-forward"}
            size={12}
            color={theme.mutedForeground}
          />
          <Text className="text-caption uppercase tracking-wider text-muted-foreground font-medium">
            {t("environments.title")}
          </Text>
          {/* Count of rows that exist right now, not of what the server ever
              reported: a section claiming "5" over an empty list is worse than
              no count at all. */}
          <Text className="text-caption tabular-nums text-muted-foreground">
            {live.length + pinned.length}
          </Text>
          {running > 0 ? (
            <View className="flex-row items-center gap-1">
              <View className="size-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
              <Text className="text-caption tabular-nums text-emerald-600 dark:text-emerald-400">
                {t("environments.running", { count: running })}
              </Text>
            </View>
          ) : null}
        </Pressable>

        {/* The "+": every environment the latest run on each machine declared.
            Always available while anything is declared — a reader with nothing
            running is exactly who wants this. */}
        {startable ? (
          <Pressable
            onPress={() => setStartOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("environments.startMenu.trigger")}
            className="px-1 py-1 active:opacity-70"
          >
            <Ionicons name="add" size={16} color={theme.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {open ? (
        <View className="pt-0.5">
          {preparingShown || justRequested ? (
            <View className="flex-row items-start gap-2 rounded-md px-1 py-2">
              <Ionicons name="sparkles-outline" size={14} color={theme.mutedForeground} style={{ marginTop: 1 }} />
              <View className="flex-1 min-w-0">
                <View className="flex-row items-center gap-2">
                  <Text className="flex-1 min-w-0 text-label font-medium text-foreground" numberOfLines={1}>
                    {t("environments.preparingTitle", { name: preparingAgentName ?? "" })}
                  </Text>
                  <Text className="shrink-0 text-caption text-muted-foreground">
                    {t("environments.state.preparing")}
                  </Text>
                </View>
                <Text className="mt-0.5 text-caption text-muted-foreground" numberOfLines={1}>
                  {t("environments.preparingHint")}
                </Text>
              </View>
            </View>
          ) : null}

          {groupOf(mainItems).map((group) => (
            <View key={group.key}>
              <MachineHeader
                title={group.machine?.title ?? t("environments.unknownMachine")}
                isCurrent={group.machine?.isCurrent ?? false}
                offline={group.offline}
              />
              {group.items.map((item) =>
                item.kind === "env"
                  ? renderEnv(item.env)
                  : item.kind === "start"
                    ? renderStart(item.start)
                    : renderFailedStart(item.start, declaringConfig(item.start), runControl, actorName, (id) =>
                        setDismissedStarts((prev) => new Set(prev).add(id)),
                      ),
              )}
            </View>
          ))}

          {ended.length > 0 ? (
            <>
              <Pressable
                onPress={() => setShowEnded((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: showEnded }}
                accessibilityLabel={
                  showEnded
                    ? t("environments.a11yHideEnded")
                    : t("environments.a11yShowEnded")
                }
                className="flex-row items-center gap-1 py-1 active:opacity-70"
              >
                <Ionicons
                  name={showEnded ? "chevron-down" : "chevron-forward"}
                  size={11}
                  color={theme.mutedForeground}
                />
                <Text className="text-micro text-muted-foreground">
                  {t("environments.endedCount", { count: ended.length })}
                </Text>
              </Pressable>
              {showEnded
                ? groupOf(
                    ended.map((env) => ({ kind: "env" as const, id: env.id, env })),
                  ).map((group) => (
                    <View key={group.key}>
                      <MachineHeader
                        title={group.machine?.title ?? t("environments.unknownMachine")}
                        isCurrent={group.machine?.isCurrent ?? false}
                        offline={group.offline}
                      />
                      {group.items.map((item) =>
                        item.kind === "env" ? renderEnv(item.env) : null,
                      )}
                    </View>
                  ))
                : null}
            </>
          ) : null}

          {isLoading && mainItems.length === 0 && ended.length === 0 ? (
            <Text className="py-1 text-caption text-muted-foreground">
              {t("environments.log.loading")}
            </Text>
          ) : null}
        </View>
      ) : null}

      <EnvironmentStartSheet
        visible={startOpen}
        onClose={() => setStartOpen(false)}
        configs={configs}
        declaredState={stateOf}
        isOffline={isOffline}
        machineTitle={(runtimeId) =>
          machineOf(runtimeId)?.title ?? t("environments.unknownMachine")
        }
        runLabel={runLabel}
        onStart={(config, declared) => {
          setStartOpen(false);
          runControl({
            action: "start",
            body: { task_id: config.task_id, repo: declared.repo, name: declared.name },
          });
        }}
        agent={
          activeAgents.find(
            (agent) => agent.id === pickStartAgentId(agents, tasks),
          ) ?? null
        }
        agentChoices={activeAgents}
        preparing={!!preparing || justRequested !== null}
        onAskAgent={(agent) => {
          setStartOpen(false);
          askAgent(agent);
        }}
      />
    </View>
  );
}

/** Which agent a start goes to when nobody picks: the issue's agent assignee,
 *  else the agent of the newest run. Mirrors web
 *  (`issue-environments-section.tsx:196-203`) without needing `assignee_id`
 *  passed in — the run list already names the agent, and an issue assigned to
 *  an agent always has at least one run by it. */
function pickStartAgentId(agents: readonly Agent[], tasks: readonly { agent_id: string; created_at: string }[]): string | null {
  const active = new Set(agents.filter((a) => !a.archived_at).map((a) => a.id));
  const ordered = [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return ordered.find((task) => active.has(task.agent_id))?.agent_id ?? null;
}

function MachineHeader({
  title,
  isCurrent,
  offline,
}: {
  title: string;
  isCurrent: boolean;
  offline: boolean;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  return (
    <View className="flex-row items-center gap-1.5 px-1 pt-1 pb-0.5">
      <Ionicons name="laptop-outline" size={12} color={theme.mutedForeground} />
      <Text className="flex-1 min-w-0 text-micro text-muted-foreground" numberOfLines={1}>
        {title}
      </Text>
      {isCurrent ? (
        <View className="shrink-0 rounded bg-muted px-1">
          <Text className="text-micro font-medium text-muted-foreground">
            {t("environments.thisMachine")}
          </Text>
        </View>
      ) : null}
      {offline ? (
        <View className="shrink-0 rounded bg-amber-500/10 px-1">
          <Text className="text-micro font-medium text-amber-600 dark:text-amber-500">
            {t("environments.offline")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function renderFailedStart(
  start: IssueEnvironmentActionRecord,
  found: { config: IssueEnvironmentConfig; declared: DeclaredEnvironment } | null,
  runControl: (action: IssueEnvironmentControl) => void,
  actorName: (record: IssueEnvironmentActionRecord) => string,
  onDismiss: (id: string) => void,
) {
  // Retry against the run that declares it NOW: the one first asked may have
  // been cleaned up since, and a start against a dead run cannot succeed.
  const taskId = found?.config.task_id ?? start.task_id;
  const canRetry = !!taskId && (found?.config.can_control ?? true);
  return (
    <FailedStartRow
      key={start.id}
      title={found?.declared.label || start.name}
      expired={start.status === "expired"}
      error={start.error}
      actor={actorName(start)}
      canRetry={canRetry}
      onRetry={() => {
        if (!taskId) return;
        runControl({
          action: "start",
          body: { task_id: taskId, repo: start.repo, name: start.name },
        });
      }}
      onDismiss={() => onDismiss(start.id)}
    />
  );
}

function FailedStartRow({
  title,
  expired,
  error,
  actor,
  canRetry,
  onRetry,
  onDismiss,
}: {
  title: string;
  expired: boolean;
  error: string;
  actor: string;
  canRetry: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  return (
    <View className="rounded-md px-1 py-2">
      <View className="flex-row items-start gap-2">
        <Ionicons name="server-outline" size={14} color={theme.destructive} style={{ marginTop: 1 }} />
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 min-w-0 text-label font-medium text-foreground" numberOfLines={1}>
              {title}
            </Text>
            <Text className="shrink-0 text-caption text-destructive">
              {expired ? t("environments.noResponse") : t("environments.failedStart")}
            </Text>
          </View>
          <Text className="mt-0.5 text-caption text-muted-foreground" numberOfLines={2}>
            {[t("environments.startedBy", { name: actor }), expired ? null : error]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <View className="mt-1.5 flex-row items-center gap-1.5">
            <Pressable
              onPress={onRetry}
              disabled={!canRetry}
              accessibilityRole="button"
              className={`rounded-md border border-border px-2 py-1 active:opacity-70 ${canRetry ? "" : "opacity-40"}`}
            >
              <Text className="text-micro font-medium text-foreground">
                {t("environments.retry")}
              </Text>
            </Pressable>
            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              className="rounded-md px-2 py-1 active:opacity-70"
            >
              <Text className="text-micro text-muted-foreground">
                {t("environments.dismiss")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

/** One environment row: its state, its machine, and the actions it allows. */
function EnvironmentRow({
  issueId,
  env,
  access,
  pinned,
  runLabel,
  actorName,
  agentName,
  timeAgo,
  onControl,
}: {
  issueId: string;
  env: IssueEnvironment;
  access: ReturnType<typeof rowAccess>;
  pinned: boolean;
  runLabel: (taskId: string | null) => string | null;
  /** Localized name for the person / agent behind an action record. */
  actorName: (record: IssueEnvironmentActionRecord) => string;
  /** An agent's display name, for a row nothing in this section started. */
  agentName: (id: string) => string;
  timeAgo: (iso: string) => string;
  onControl: (action: IssueEnvironmentControl) => void;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const [logsOpen, setLogsOpen] = useState(false);
  const caps = rowCapabilities(env, { offline: access.offline });
  const pending = pendingAction(env);
  const failure = pending ? null : recentFailure(env, Date.now());
  const app = env.kind === "app";
  const title = environmentTitle(env);
  const host = !app && env.url ? safeHost(env.url) : null;
  const declared = env.source === "config";
  const meta = environmentMeta(env, pending, { timeAgo, actorName, now: Date.now() });

  // Who started a row nobody in this section asked for: an agent, in one of
  // its runs. `runLabel` names the run only when the issue's run list is still
  // deduped to a known ordinal; without it the bare "Started by X" is true and
  // needs no number.
  const origin = (() => {
    if (declared) return null;
    if (env.agent_id) {
      const run = runLabel(env.task_id);
      return run
        ? t("environments.startedByAgentInRun", { name: agentName(env.agent_id), run })
        : t("environments.startedBy", { name: agentName(env.agent_id) });
    }
    const originRecord = env.origin;
    if (originRecord) {
      return originRecord.action === "restart"
        ? t("environments.restartedBy", { name: actorName(originRecord) })
        : t("environments.startedBy", { name: actorName(originRecord) });
    }
    return null;
  })();

  const openUrl = () => {
    void Linking.openURL(env.url).catch(() => {
      Alert.alert(t("environments.open"), access.localhostHint ?? undefined);
    });
  };

  const copyUrl = () => {
    void Clipboard.setStringAsync(env.url).then((ok) => {
      if (ok === false) return;
    });
  };

  const stop = () => {
    // A detected service is not supervised: once stopped there is no command to
    // bring it back, so the confirmation says so before the reader commits.
    if (!declared) {
      Alert.alert(
        t("environments.stopConfirmTitle", { name: title }),
        t("environments.stopConfirmBody", { process: env.name }),
        [
          { text: t("environments.cancel"), style: "cancel" },
          {
            text: t("environments.stop"),
            style: "destructive",
            onPress: () => onControl({ action: "stop", environmentId: env.id }),
          },
        ],
      );
      return;
    }
    onControl({ action: "stop", environmentId: env.id });
  };

  const openMenu = () => {
    const options: string[] = [];
    const actions: (() => void)[] = [];
    if (caps.canReadLogs) {
      options.push(t("environments.viewLogs"));
      actions.push(() => setLogsOpen(true));
    }
    if (caps.canRestart) {
      options.push(t("environments.restart"));
      actions.push(() => onControl({ action: "restart", environmentId: env.id }));
    }
    if (caps.canStop) {
      options.push(
        declared
          ? t("environments.stop")
          : `${t("environments.stop")}…`,
      );
      actions.push(stop);
    }
    if (options.length === 0) return;
    options.push(t("environments.cancel"));
    ActionSheet.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: options.length - 1,
        destructiveButtonIndex: caps.canStop ? options.length - 2 : undefined,
        title,
      },
      (index) => {
        if (index === options.length - 1) return;
        actions[index]?.();
      },
    );
  };

  const Icon = app ? "phone-portrait-outline" : env.url ? "globe-outline" : "server-outline";

  return (
    <View className="rounded-md">
      <Pressable
        onPress={caps.openable ? openUrl : caps.hasMenu ? openMenu : undefined}
        onLongPress={caps.hasMenu ? openMenu : undefined}
        delayLongPress={350}
        accessibilityRole={caps.openable ? "link" : "button"}
        accessibilityLabel={t("environments.a11yRow", {
          name: title,
          state: t(`environments.state.${caps.rowState}`),
        })}
        className="flex-row items-start gap-2 rounded-md px-1 py-2 active:opacity-70"
      >
        <Ionicons
          name={Icon}
          size={14}
          color={theme.foreground}
          style={{ marginTop: 1 }}
        />
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 min-w-0 text-label font-medium text-foreground" numberOfLines={1}>
              {title}
            </Text>
            <Text className={`shrink-0 text-caption ${STATE_TONE[caps.rowState]}`}>
              {t(`environments.state.${caps.rowState}`)}
            </Text>
          </View>
          <Text className="mt-0.5 text-caption text-muted-foreground tabular-nums" numberOfLines={1}>
            {[host, metaText(t, meta), failure ? failureText(t, failure) : null]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {origin ? (
            <Text className="mt-0.5 text-micro text-muted-foreground" numberOfLines={1}>
              {origin}
            </Text>
          ) : null}
          {pinned && env.excerpt ? (
            <View className="mt-1 rounded bg-destructive/10 px-2 py-1">
              <Text className="text-micro font-mono text-destructive" numberOfLines={2}>
                {env.excerpt.split("\n").slice(-2).join("\n")}
              </Text>
            </View>
          ) : null}
        </View>
        {caps.openable ? (
          <Pressable
            onPress={copyUrl}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("environments.copyUrl")}
            className="p-1 active:opacity-70"
          >
            <Ionicons name="copy-outline" size={13} color={theme.mutedForeground} />
          </Pressable>
        ) : null}
        {caps.hasMenu ? (
          <Pressable
            onPress={openMenu}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("environments.moreActions")}
            className="p-1 active:opacity-70"
          >
            <Ionicons name="ellipsis-horizontal" size={14} color={theme.mutedForeground} />
          </Pressable>
        ) : null}
      </Pressable>

      {/* A pinned crash keeps its two exits on the row: they are the reason the
          row is still on screen at all. */}
      {pinned ? (
        <View className="flex-row items-center gap-1.5 pl-7 pb-2">
          <Pressable
            onPress={() => setLogsOpen(true)}
            disabled={!env.controllable}
            accessibilityRole="button"
            className={`rounded-md border border-border px-2 py-1 active:opacity-70 ${env.controllable ? "" : "opacity-40"}`}
          >
            <Text className="text-micro font-medium text-foreground">
              {t("environments.viewLogs")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onControl({ action: "restart", environmentId: env.id })}
            disabled={!caps.canRestart}
            accessibilityRole="button"
            className={`rounded-md border border-border px-2 py-1 active:opacity-70 ${caps.canRestart ? "" : "opacity-40"}`}
          >
            <Text className="text-micro font-medium text-foreground">
              {t("environments.restart")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Why the row's controls are inert, stated once under the row. A greyed
          button with no reason reads as a bug. */}
      {!caps.operable && isLive(env) ? (
        <Text className="pl-7 pb-1.5 text-micro text-muted-foreground" numberOfLines={2}>
          {access.offline
            ? access.machineTitle
              ? t("environments.machineOffline", { machine: access.machineTitle })
              : t("environments.offlineHint")
            : !env.controllable
              ? t("environments.outdatedHint")
              : !env.can_control
                ? t("environments.noPermissionHint")
                : null}
        </Text>
      ) : null}

      <EnvironmentLogSheet
        issueId={issueId}
        env={env}
        visible={logsOpen}
        onClose={() => setLogsOpen(false)}
        machineTitle={access.machineTitle}
        offline={access.offline}
        canRestart={caps.canRestart}
        onRestart={() => onControl({ action: "restart", environmentId: env.id })}
      />
    </View>
  );
}

function metaText(
  t: (id: string, params?: Record<string, string | number>) => string,
  meta: EnvironmentMeta,
): string {
  return t(meta.key, meta.params);
}

function failureText(
  t: (id: string, params?: Record<string, string | number>) => string,
  failure: IssueEnvironmentActionRecord,
): string {
  if (failure.status === "expired") return t("environments.noResponse");
  return t("environments.actionFailedGeneric", {
    action: t(
      failure.action === "restart"
        ? "environments.actionRestart"
        : "environments.actionStart",
    ),
  });
}

function safeHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return null;
  }
}

/** The start menu. A sheet rather than web's nested dropdown: a phone has no
 *  submenu affordance, and web's flow nests machine → environment → agent
 *  three levels deep. */
function EnvironmentStartSheet({
  visible,
  onClose,
  configs,
  declaredState,
  isOffline,
  machineTitle,
  runLabel,
  onStart,
  agent,
  agentChoices,
  preparing,
  onAskAgent,
}: {
  visible: boolean;
  onClose: () => void;
  configs: readonly IssueEnvironmentConfig[];
  declaredState: (
    config: IssueEnvironmentConfig,
    declared: DeclaredEnvironment,
  ) => "available" | "running" | "starting";
  isOffline: (runtimeId: string | null) => boolean;
  machineTitle: (runtimeId: string) => string;
  runLabel: (taskId: string | null) => string | null;
  onStart: (config: IssueEnvironmentConfig, declared: DeclaredEnvironment) => void;
  agent: Agent | null;
  agentChoices: readonly Agent[];
  preparing: boolean;
  onAskAgent: (agent: Agent) => void;
}) {
  const { t } = useTranslation();
  const theme = useThemePalette();
  const declaring = configs.filter((config) => config.environments.length > 0);
  const [pickAgent, setPickAgent] = useState(false);

  const askLabel = agent
    ? t("environments.startMenu.askAgent", { name: agent.name })
    : t("environments.startMenu.askAnyAgent");
  const askSide = preparing
    ? t("environments.startMenu.preparing")
    : t("environments.startMenu.newRun");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <View className="flex-1 justify-end">
          <Pressable onPress={() => {}} className="bg-popover rounded-t-2xl max-h-[75%]">
            <View className="px-4 py-3 border-b border-border flex-row items-center justify-between">
              <Text className="text-title-sm font-semibold text-foreground">
                {t("environments.startMenu.trigger")}
              </Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
                <Ionicons name="close" size={20} color={theme.foreground} />
              </Pressable>
            </View>

            <ScrollView className="max-h-[60vh]">
              {declaring.map((config) => {
                const offline = isOffline(config.runtime_id);
                const run = runLabel(config.task_id);
                const machine = machineTitle(config.runtime_id);
                return (
                  <View key={config.runtime_id} className="pt-2">
                    <View className="flex-row items-center gap-1.5 px-4 pb-1">
                      <Text className="flex-1 min-w-0 text-micro font-medium text-muted-foreground" numberOfLines={1}>
                        {run
                          ? t("environments.startMenu.runLabel", { machine, run })
                          : machine}
                      </Text>
                      {offline ? (
                        <View className="rounded bg-amber-500/10 px-1">
                          <Text className="text-micro font-medium text-amber-600 dark:text-amber-500">
                            {t("environments.offline")}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {config.environments.map((declared) => {
                      const state = declaredState(config, declared);
                      const disabled =
                        state !== "available" || offline || !config.can_control;
                      return (
                        <Pressable
                          key={`${declared.repo}/${declared.name}`}
                          onPress={() => onStart(config, declared)}
                          disabled={disabled}
                          accessibilityRole="button"
                          className={`flex-row items-center gap-2 px-4 py-2 active:opacity-70 ${disabled ? "opacity-40" : ""}`}
                        >
                          <Ionicons name="server-outline" size={14} color={theme.mutedForeground} />
                          <Text className="flex-1 min-w-0 text-label text-foreground" numberOfLines={1}>
                            {declared.label || declared.name}
                          </Text>
                          <Text className="shrink-0 max-w-[45%] text-caption text-muted-foreground" numberOfLines={1}>
                            {state === "running"
                              ? t("environments.state.running")
                              : state === "starting"
                                ? t("environments.state.starting")
                                : declared.start}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}

              {declaring.length > 0 ? (
                <Text className="px-4 py-2 text-caption text-muted-foreground">
                  {declaring.some((config) => !config.can_control)
                    ? t("environments.startMenu.noPermission")
                    : t("environments.startMenu.note")}
                </Text>
              ) : (
                <Text className="px-4 py-2 text-caption text-muted-foreground">
                  {t("environments.startMenu.nothingToStart")}
                </Text>
              )}

              <View className="border-t border-border">
                <Pressable
                  onPress={() => {
                    if (agent) {
                      onAskAgent(agent);
                      return;
                    }
                    if (agentChoices.length === 1) {
                      onAskAgent(agentChoices[0]!);
                      return;
                    }
                    setPickAgent((v) => !v);
                  }}
                  disabled={preparing || (!agent && agentChoices.length === 0)}
                  accessibilityRole="button"
                  className={`flex-row items-center gap-2 px-4 py-2 active:opacity-70 ${preparing ? "opacity-40" : ""}`}
                >
                  <Ionicons name="sparkles-outline" size={14} color={theme.mutedForeground} />
                  <Text className="flex-1 min-w-0 text-label text-foreground" numberOfLines={1}>
                    {askLabel}
                  </Text>
                  <Text className="shrink-0 text-caption text-muted-foreground">
                    {askSide}
                  </Text>
                </Pressable>
                {/* The agent submenu, flattened: web nests machines → envs →
                    agents; a phone gets one expandable list instead. */}
                {pickAgent && !agent
                  ? agentChoices.map((choice) => (
                      <Pressable
                        key={choice.id}
                        onPress={() => {
                          setPickAgent(false);
                          onAskAgent(choice);
                        }}
                        accessibilityRole="button"
                        className="px-4 py-2 pl-10 active:opacity-70"
                      >
                        <Text className="text-label text-foreground" numberOfLines={1}>
                          {choice.name}
                        </Text>
                      </Pressable>
                    ))
                  : null}
                {declaring.length === 0 ? (
                  <Text className="px-4 pb-2 text-caption text-muted-foreground">
                    {agent
                      ? t("environments.startMenu.askAgentHint", { name: agent.name })
                      : t("environments.startMenu.askAnyAgentHint")}
                  </Text>
                ) : null}
              </View>
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
