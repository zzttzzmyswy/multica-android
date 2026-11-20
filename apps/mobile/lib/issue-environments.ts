/**
 * Pure rules for the issue's "Environments" section — the servers and desktop
 * apps this issue's runs left running.
 *
 * Ported from web's `packages/views/issues/components/environment-model.ts`
 * plus the grouping/access half of `issue-environments-section.tsx`, because
 * the two clients read the SAME server payload and must reach the same verdict
 * about it: which row is live, whether a crash stays on screen, who may stop
 * what, and which machine a row belongs to.
 *
 * Why the section exists at all: an agent run starts the project's services
 * (declared in `.multica/environments.toml`, or found listening in the run
 * directory) and leaves them running. Web surfaces them in the issue sidebar,
 * so a reader can open the preview, read the log, restart a crashed service or
 * start another one. Mobile had no such surface — a phone user could not even
 * tell that the issue had a service running, let alone act on it.
 *
 * Node-safe on purpose (mobile's vitest lane is Node-only, see
 * `apps/mobile/vitest.config.ts`): this module imports types only, so every
 * branch below is exercised without a renderer.
 */
import type {
  AgentTask,
  DeclaredEnvironment,
  IssueEnvironment,
  IssueEnvironmentActionRecord,
  IssueEnvironmentConfig,
  IssueEnvironmentState,
} from "@multica/core/types";

const DAY = 24 * 60 * 60_000;
/** How long a failed stop / restart keeps showing on its row. */
const RECENT_FAILURE = 10 * 60_000;

/** The localized "let the agent start it" instruction contains this command,
 *  which is how the section recognizes those runs in any language — the copy
 *  itself is translated, the command is not. Mirrors web's
 *  `ENVIRONMENT_START_MARKER`. */
export const ENVIRONMENT_START_MARKER = "multica env start";

/** A row with no end time is the only kind a reader may act on. */
export function isLive(env: IssueEnvironment): boolean {
  return env.ended_at === null;
}

/** The exit code a daemon recorded as `exit status N`, if any. */
export function exitCode(env: IssueEnvironment): number | null {
  const match = /exit status (\d+)/.exec(env.detail);
  return match ? Number(match[1]) : null;
}

/** Whether a reported row is the one `repo` declares as `name` on a machine.
 *  Two repositories in one run may declare the same name; rows from daemons
 *  that predate reporting the repository match on the name alone. */
export function isDeclaredAs(
  env: IssueEnvironment,
  runtimeId: string | null,
  repo: string,
  name: string,
): boolean {
  return (
    env.source === "config" &&
    env.runtime_id === runtimeId &&
    env.name === name &&
    (env.repo === "" || env.repo === repo)
  );
}

/**
 * A declared environment that crashed stays on screen for a day, or until it
 * is restarted / another one with its name comes up on that machine.
 *
 * Only declared rows qualify: a detected row is a process the daemon merely
 * noticed, so pinning it would keep a service the reader never asked for in
 * front of them for a day.
 */
export function isPinnedCrash(
  env: IssueEnvironment,
  all: readonly IssueEnvironment[],
  now: number,
): boolean {
  if (env.source !== "config" || env.state !== "exited" || !env.ended_at) return false;
  const code = exitCode(env);
  // A clean exit is not a crash. A row with neither an exit code nor any
  // output tells the reader nothing worth a pinned row.
  if (code === 0 || (code === null && !env.excerpt)) return false;
  const ended = new Date(env.ended_at).getTime();
  if (now - ended > DAY) return false;
  return !all.some(
    (other) =>
      other.id !== env.id &&
      isDeclaredAs(other, env.runtime_id, env.repo, env.name) &&
      new Date(other.started_at).getTime() >= ended,
  );
}

/** The command the machine is still working on for this row. */
export function pendingAction(
  env: IssueEnvironment,
): IssueEnvironmentActionRecord | null {
  return env.pending_action?.status === "pending" ? env.pending_action : null;
}

/** A stop or restart that failed or went unanswered in the last few minutes.
 *  A log read is not a control action, so it never surfaces here. */
export function recentFailure(
  env: IssueEnvironment,
  now: number,
): IssueEnvironmentActionRecord | null {
  const last = env.last_action;
  if (!last || last.action === "logs") return null;
  if (last.status !== "failed" && last.status !== "expired") return null;
  const at = new Date(last.completed_at ?? last.created_at).getTime();
  return now - at <= RECENT_FAILURE ? last : null;
}

/** 1-based position of each run on the issue, oldest first. Ids are
 *  time-ordered, which settles runs created in the same second. */
export function runOrdinals(tasks: readonly AgentTask[]): Map<string, number> {
  const ordered = [...tasks].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  return new Map(ordered.map((task, index) => [task.id, index + 1]));
}

// Same set web uses (`environment-model.ts:62`). `deferred` is included even
// though the run has not started: it is parked, not discarded, and the agent
// will start the environment when its backoff fires — so "preparing" is still
// the honest label.
const ACTIVE_TASK_STATUSES = new Set<AgentTask["status"]>([
  "queued",
  "dispatched",
  "waiting_local_directory",
  "deferred",
  "running",
]);

export function isActiveTask(task: AgentTask): boolean {
  return ACTIVE_TASK_STATUSES.has(task.status);
}

/** The run asked to start this issue's environment that is still under way —
 *  either one this section asked for by comment, or any run whose summary
 *  carries the start command. */
export function preparingRun(
  tasks: readonly AgentTask[],
  requestedCommentIds: ReadonlySet<string>,
): AgentTask | null {
  return (
    tasks.find(
      (task) =>
        isActiveTask(task) &&
        ((task.trigger_comment_id !== undefined &&
          requestedCommentIds.has(task.trigger_comment_id)) ||
          (task.trigger_summary ?? "").includes(ENVIRONMENT_START_MARKER)),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Row capabilities — who may do what, and when
// ---------------------------------------------------------------------------

/** The three states a row's leading tone is chosen from. `stopping` is not a
 *  server state: it is what a row reads as while a stop is in flight. */
export type EnvironmentRowState = IssueEnvironmentState | "stopping";

export interface RowCapabilities {
  /** Whether the machine can carry the command out at all. */
  operable: boolean;
  canStop: boolean;
  canRestart: boolean;
  canReadLogs: boolean;
  /** The row's address can be opened in a browser. */
  openable: boolean;
  /** Whether the row's menu has anything in it. */
  hasMenu: boolean;
  hasActions: boolean;
  rowState: EnvironmentRowState;
}

/**
 * Decide every action a row offers.
 *
 * The three gates are deliberately separate and ALL required — a daemon too
 * old to accept commands (`controllable`), a member without permission
 * (`can_control`) and a machine that is offline each rule out a different
 * thing, and offering a button when any of them fails produces a request the
 * server (or the silence of an offline machine) will refuse.
 *
 * Closing an app's window (`focus`) is NOT here: that is a Desktop-only
 * bridge with no mobile equivalent, so mobile never offers it.
 */
export function rowCapabilities(
  env: IssueEnvironment,
  access: { offline: boolean },
): RowCapabilities {
  const live = isLive(env);
  const pending = pendingAction(env);
  const declared = env.source === "config";
  const operable = env.controllable && env.can_control && !access.offline && !pending;
  const canStop = live && operable;
  const canRestart = declared && operable;
  const canReadLogs = declared && env.controllable && !access.offline;
  const app = env.kind === "app";
  // An `unreachable` row still has a URL, but the last thing known about it is
  // that nothing answered there — opening it would show the reader an error
  // page and call it a feature.
  const openable = !app && live && !pending && env.url !== "" && env.state !== "unreachable";
  const hasMenu = (declared || !app) && (live || declared);
  const rowState: EnvironmentRowState =
    pending?.action === "stop" ? "stopping" : pending ? "starting" : env.state;
  return {
    operable,
    canStop,
    canRestart,
    canReadLogs,
    openable,
    hasMenu,
    hasActions: openable || canRestart || hasMenu,
    rowState,
  };
}

export interface RowMachine {
  title: string;
  isCurrent: boolean;
}

export interface RowAccess {
  machineTitle: string | null;
  offline: boolean;
  /** Why a localhost URL will not open here; null when it will. */
  localhostHint: string | null;
  /** Why an app's window cannot be raised from here; null when it can. */
  appHint: string | null;
}

/**
 * The contextual warnings a row carries.
 *
 * Keys, not finished sentences: mobile's `t()` is a flat dictionary, and the
 * machine name is a `{{machine}}` binding. Returning a key keeps the wording in
 * the bundle where the translator can reach it — the reason web can inline the
 * sentence and mobile cannot.
 *
 * `knowsLocal` is "this client knows which machine it is on". A phone never
 * runs the daemon, so it is always false here; the parameter stays because the
 * decision it feeds (`localhostHint` absent when the row IS on this machine)
 * has to be stated, not silently assumed.
 */
export function rowAccess({
  machine,
  offline,
  knowsLocal,
}: {
  machine: RowMachine | null;
  offline: boolean;
  knowsLocal: boolean;
}): RowAccess {
  const localhostHint =
    knowsLocal && machine?.isCurrent
      ? null
      : machine
        ? "environments.remoteHint"
        : "environments.localhostHint";
  const appHint =
    machine && !(knowsLocal && machine.isCurrent)
      ? "environments.appRemoteHint"
      : "environments.appDesktopHint";
  return {
    machineTitle: machine?.title ?? null,
    offline,
    localhostHint,
    appHint,
  };
}

// ---------------------------------------------------------------------------
// Machine grouping
// ---------------------------------------------------------------------------

export interface MachineGroup<T> {
  key: string;
  machine: RowMachine | null;
  offline: boolean;
  items: T[];
}

/**
 * Group rows by the machine that runs them.
 *
 * Grouping is not cosmetic: a localhost URL only opens on the machine running
 * it, so a flat list would let a reader tap an address that cannot answer.
 * Online machines come first; a runtime this member cannot see AND one this
 * client has no record of both land in one `unknown` bucket, which reads as
 * offline (nothing can be asked of it).
 */
export function groupByMachine<T>(
  items: readonly T[],
  {
    machineOf,
    isOffline,
  }: {
    machineOf: (runtimeId: string | null) => (RowMachine & { machineId: string }) | null;
    isOffline: (runtimeId: string | null) => boolean;
  },
): MachineGroup<T>[] {
  const byMachine = new Map<string, MachineGroup<T>>();
  for (const item of items) {
    const runtimeId = runtimeIdOf(item);
    const machine = machineOf(runtimeId);
    const key = machine?.machineId ?? "unknown";
    const group = byMachine.get(key) ?? {
      key,
      machine: machine ? { title: machine.title, isCurrent: machine.isCurrent } : null,
      offline: true,
      items: [],
    };
    group.items.push(item);
    group.offline = group.offline && isOffline(runtimeId);
    byMachine.set(key, group);
  }
  return [...byMachine.values()].sort(
    (a, b) =>
      Number(a.offline) - Number(b.offline) ||
      Number(b.machine?.isCurrent ?? false) - Number(a.machine?.isCurrent ?? false),
  );
}

/** How a group reads a row's runtime id — an environment carries its own, a
 *  start / failure record carries the one it was asked of. */
function runtimeIdOf(item: unknown): string | null {
  const record = item as { runtime_id?: string | null; env?: IssueEnvironment };
  if (record.env) return record.env.runtime_id;
  return record.runtime_id ?? null;
}

/** The row kinds the section lists, in the order it lists them. */
export type EnvironmentRowItem =
  | { kind: "env"; id: string; env: IssueEnvironment }
  | { kind: "start"; id: string; start: IssueEnvironmentActionRecord }
  | { kind: "failed"; id: string; start: IssueEnvironmentActionRecord };

const ROW_KIND_RANK: Record<EnvironmentRowItem["kind"], number> = {
  env: 0,
  start: 1,
  failed: 2,
};

/** Live rows, then starts nobody has answered yet, then recent failures —
 *  web's `mainItems` order (`issue-environments-section.tsx:307-311`), which
 *  puts what IS running above what is merely being attempted. */
export function sortRowItems<T extends { kind: EnvironmentRowItem["kind"] }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => ROW_KIND_RANK[a.kind] - ROW_KIND_RANK[b.kind]);
}

/** What the start menu may offer for one declared environment. */
export type DeclaredState = "available" | "running" | "starting";

/** Whether a declared environment can be started, is already up, or is on its
 *  way up — from the section's own unanswered starts AND the live rows. */
export function declaredState(
  config: IssueEnvironmentConfig,
  declared: DeclaredEnvironment,
  live: readonly IssueEnvironment[],
  pendingStarts: readonly IssueEnvironmentActionRecord[],
): DeclaredState {
  if (
    pendingStarts.some(
      (start) =>
        start.runtime_id === config.runtime_id &&
        start.repo === declared.repo &&
        start.name === declared.name,
    )
  ) {
    return "starting";
  }
  const current = live.find((env) =>
    isDeclaredAs(env, config.runtime_id, declared.repo, declared.name),
  );
  if (!current) return "available";
  return current.state === "starting" || pendingAction(current)?.action === "restart"
    ? "starting"
    : "running";
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "[::1]" ||
      host === "0.0.0.0" ||
      host.startsWith("127.")
    );
  } catch {
    return false;
  }
}

/** The address without its scheme, for the row's secondary line. */
export function displayHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}`;
  } catch {
    return null;
  }
}

/** The row's title. A detected row has no declared label, so the address it
 *  answers on is the only thing a reader recognizes — its `name` is the
 *  daemon's internal key. An app has no address, so it keeps its name. */
export function environmentTitle(env: IssueEnvironment): string {
  const app = env.kind === "app";
  const host = !app && env.url ? displayHost(env.url) : null;
  return app || env.source === "config" ? env.label || env.name : (host ?? env.name);
}

/** A translated line plus its bindings. Mobile's dictionary is flat, so the
 *  join web does inline ("Started by X · waiting") is done at the call site. */
export interface EnvironmentMeta {
  key: string;
  params?: Record<string, string | number>;
}

/**
 * The row's secondary line.
 *
 * Precedence mirrors web's `environmentMeta`: what the machine is doing right
 * now beats what the row's state says, because a stop in flight has not changed
 * the row's state yet — the row is still `running` until the machine answers.
 */
export function environmentMeta(
  env: IssueEnvironment,
  pending: IssueEnvironmentActionRecord | null,
  {
    timeAgo,
    actorName,
    now,
  }: {
    timeAgo: (iso: string) => string;
    actorName: (record: IssueEnvironmentActionRecord) => string;
    now: number;
  },
): EnvironmentMeta {
  if (pending?.action === "stop") return { key: "environments.waitingMachine" };
  if (pending?.action === "restart") {
    return {
      key: "environments.restartedByWaiting",
      params: { name: actorName(pending) },
    };
  }
  if (env.ended_at) {
    const code = exitCode(env);
    if (env.state === "exited" && code !== null && code !== 0) {
      return {
        key: "environments.exitedWithCode",
        params: { time: timeAgo(env.ended_at), code },
      };
    }
    const last = env.last_action;
    if (env.state === "stopped" && last?.action === "stop" && last.status === "succeeded") {
      return {
        key: "environments.stoppedBy",
        params: { name: actorName(last), time: timeAgo(env.ended_at) },
      };
    }
    if (env.state === "stopped" && env.detail === "expired") {
      return { key: "environments.stoppedOnExpiry" };
    }
    return { key: "environments.endedAgo", params: { time: timeAgo(env.ended_at) } };
  }
  if (env.state === "unreachable") {
    return { key: "environments.lastSeen", params: { time: timeAgo(env.last_seen_at) } };
  }
  if (env.state === "starting" && env.origin) {
    return {
      key:
        env.origin.action === "restart"
          ? "environments.restartedByWaiting"
          : "environments.startedByWaiting",
      params: { name: actorName(env.origin) },
    };
  }
  if (env.expires_at) {
    // Round UP and clamp at 1: `Math.round` would read "expires in 0m" for a
    // row that is still running, which is indistinguishable from "expired".
    const minutes = Math.max(
      1,
      Math.ceil((new Date(env.expires_at).getTime() - now) / 60_000),
    );
    if (minutes < 60) {
      return { key: "environments.expiresInMinutes", params: { count: minutes } };
    }
    const hours = Math.round(minutes / 60);
    if (hours < 48) {
      return { key: "environments.expiresInHours", params: { count: hours } };
    }
    return { key: "environments.expiresInDays", params: { count: Math.round(hours / 24) } };
  }
  return { key: "environments.startedAgo", params: { time: timeAgo(env.started_at) } };
}

export type LogLevel = "error" | "warn" | null;

/** Colors a log the way a reader scans it: errors — and the indented lines
 *  continuing them, as in a stack trace — in red, warnings in amber. */
export function classifyLogLines(lines: readonly string[]): LogLevel[] {
  const levels: LogLevel[] = [];
  let previous: LogLevel = null;
  for (const line of lines) {
    let level: LogLevel = null;
    if (
      /\b(ERROR|ERR|FATAL|PANIC)\b|^(panic|fatal error|error|Error)\b|\*\*\*.*\bError\b/.test(
        line,
      )
    ) {
      level = "error";
    } else if (/\b(WARN|WARNING)\b/.test(line)) {
      level = "warn";
    } else if (previous === "error" && /^\s+\S/.test(line)) {
      level = "error";
    }
    levels.push(level);
    previous = level;
  }
  return levels;
}
