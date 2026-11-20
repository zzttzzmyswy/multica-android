/**
 * Pure rules for the issue "Environments" section — ported from web's
 * `packages/views/issues/components/environment-model.ts` plus the
 * machine-grouping half of `issue-environments-section.tsx`.
 *
 * Every case names the web behaviour it pins, because the two clients must
 * reach the same verdict about the SAME server payload: which rows are live,
 * which crashed environment stays pinned, who may stop what, and what order
 * the machine groups come out in.
 */
import { describe, expect, it } from "vitest";
import type {
  AgentTask,
  IssueEnvironment,
  IssueEnvironmentActionRecord,
  IssueEnvironmentConfig,
} from "@multica/core/types";
import {
  classifyLogLines,
  declaredState,
  displayHost,
  environmentMeta,
  environmentTitle,
  exitCode,
  groupByMachine,
  isDeclaredAs,
  isLive,
  isLoopbackUrl,
  isPinnedCrash,
  pendingAction,
  preparingRun,
  recentFailure,
  rowAccess,
  rowCapabilities,
  runOrdinals,
  sortRowItems,
} from "./issue-environments";

function env(overrides: Partial<IssueEnvironment> = {}): IssueEnvironment {
  return {
    id: "env-1",
    issue_id: "issue-1",
    task_id: "task-1",
    runtime_id: "runtime-1",
    agent_id: null,
    local_key: "key-1",
    source: "config",
    kind: "server",
    repo: "org/app",
    name: "web",
    label: "Web",
    url: "http://localhost:3000",
    port: 3000,
    state: "running",
    detail: "",
    excerpt: "",
    started_at: "2026-11-20T10:00:00Z",
    expires_at: null,
    last_seen_at: "2026-11-20T10:00:00Z",
    ended_at: null,
    controllable: true,
    can_control: true,
    pending_action: null,
    last_action: null,
    origin: null,
    ...overrides,
  };
}

function record(
  overrides: Partial<IssueEnvironmentActionRecord> = {},
): IssueEnvironmentActionRecord {
  return {
    id: "act-1",
    action: "start",
    status: "succeeded",
    error: "",
    environment_id: null,
    runtime_id: "runtime-1",
    task_id: "task-1",
    repo: "org/app",
    name: "web",
    actor_type: "member",
    actor_id: "user-1",
    created_at: "2026-11-20T10:00:00Z",
    completed_at: "2026-11-20T10:00:05Z",
    ...overrides,
  };
}

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1",
    agent_id: "agent-1",
    status: "running",
    created_at: "2026-11-20T10:00:00Z",
    ...overrides,
  } as AgentTask;
}

const NOW = Date.parse("2026-11-20T12:00:00Z");

describe("isLive", () => {
  it("reads a row with no end time as live", () => {
    expect(isLive(env({ ended_at: null }))).toBe(true);
  });

  it("reads an ended row as not live, whatever its state says", () => {
    expect(isLive(env({ ended_at: "2026-11-20T11:00:00Z", state: "running" }))).toBe(
      false,
    );
  });
});

describe("exitCode", () => {
  it("extracts the daemon's `exit status N` detail", () => {
    expect(exitCode(env({ detail: "exit status 1" }))).toBe(1);
  });

  it("returns null when the detail carries no exit status", () => {
    expect(exitCode(env({ detail: "stopped" }))).toBeNull();
  });
});

describe("isDeclaredAs", () => {
  it("matches a declared environment by runtime, repo and name", () => {
    expect(isDeclaredAs(env(), "runtime-1", "org/app", "web")).toBe(true);
  });

  it("does not match a detected environment", () => {
    expect(isDeclaredAs(env({ source: "detected" }), "runtime-1", "org/app", "web")).toBe(
      false,
    );
  });

  it("matches on the name alone when the reporting daemon predates repos", () => {
    // A daemon older than repo reporting sends "" — the name is all we have.
    expect(isDeclaredAs(env({ repo: "" }), "runtime-1", "org/app", "web")).toBe(true);
  });

  it("does not match a different repo on a daemon that does report it", () => {
    expect(isDeclaredAs(env({ repo: "org/other" }), "runtime-1", "org/app", "web")).toBe(
      false,
    );
  });

  it("does not match a different runtime", () => {
    expect(isDeclaredAs(env(), "runtime-2", "org/app", "web")).toBe(false);
  });
});

describe("isPinnedCrash", () => {
  it("pins a declared environment that exited non-zero within the day", () => {
    const crashed = env({
      source: "config",
      state: "exited",
      ended_at: "2026-11-20T11:30:00Z",
      detail: "exit status 2",
    });
    expect(isPinnedCrash(crashed, [crashed], NOW)).toBe(true);
  });

  it("does not pin a clean exit", () => {
    const clean = env({
      source: "config",
      state: "exited",
      ended_at: "2026-11-20T11:30:00Z",
      detail: "exit status 0",
    });
    expect(isPinnedCrash(clean, [clean], NOW)).toBe(false);
  });

  it("does not pin a crash with no exit code and no excerpt", () => {
    const bare = env({
      source: "config",
      state: "exited",
      ended_at: "2026-11-20T11:30:00Z",
      detail: "",
      excerpt: "",
    });
    expect(isPinnedCrash(bare, [bare], NOW)).toBe(false);
  });

  it("pins a crash that printed an excerpt even without an exit code", () => {
    const bare = env({
      source: "config",
      state: "exited",
      ended_at: "2026-11-20T11:30:00Z",
      detail: "",
      excerpt: "panic: boom",
    });
    expect(isPinnedCrash(bare, [bare], NOW)).toBe(true);
  });

  it("does not pin a crash older than a day", () => {
    const old = env({
      source: "config",
      state: "exited",
      ended_at: "2026-11-18T11:30:00Z",
      detail: "exit status 2",
    });
    expect(isPinnedCrash(old, [old], NOW)).toBe(false);
  });

  it("unpins once the same environment came back on that machine", () => {
    const crashed = env({
      id: "env-old",
      source: "config",
      state: "exited",
      ended_at: "2026-11-20T11:30:00Z",
      detail: "exit status 2",
    });
    const restarted = env({
      id: "env-new",
      state: "running",
      started_at: "2026-11-20T11:45:00Z",
      ended_at: null,
    });
    expect(isPinnedCrash(crashed, [crashed, restarted], NOW)).toBe(false);
  });

  it("does not pin a detected environment's exit", () => {
    const detected = env({
      source: "detected",
      state: "exited",
      ended_at: "2026-11-20T11:30:00Z",
      detail: "exit status 2",
    });
    expect(isPinnedCrash(detected, [detected], NOW)).toBe(false);
  });
});

describe("pendingAction", () => {
  it("returns a stop or restart the machine has not answered yet", () => {
    const pending = record({ action: "stop", status: "pending" });
    expect(pendingAction(env({ pending_action: pending }))).toBe(pending);
  });

  it("returns null for a settled action", () => {
    expect(
      pendingAction(env({ pending_action: record({ status: "succeeded" }) })),
    ).toBeNull();
  });
});

describe("recentFailure", () => {
  it("surfaces a stop that failed moments ago", () => {
    const failed = record({
      action: "stop",
      status: "failed",
      completed_at: "2026-11-20T11:58:00Z",
    });
    expect(recentFailure(env({ last_action: failed }), NOW)).toEqual(failed);
  });

  it("surfaces an unanswered action as `expired`", () => {
    const expired = record({
      action: "restart",
      status: "expired",
      completed_at: "2026-11-20T11:58:00Z",
    });
    expect(recentFailure(env({ last_action: expired }), NOW)).toEqual(expired);
  });

  it("ignores a log read, which is not a control action", () => {
    const logs = record({
      action: "logs",
      status: "failed",
      completed_at: "2026-11-20T11:58:00Z",
    });
    expect(recentFailure(env({ last_action: logs }), NOW)).toBeNull();
  });

  it("forgets a failure older than the window", () => {
    const stale = record({
      action: "stop",
      status: "failed",
      completed_at: "2026-11-20T11:00:00Z",
    });
    expect(recentFailure(env({ last_action: stale }), NOW)).toBeNull();
  });
});

describe("runOrdinals", () => {
  it("numbers runs oldest first", () => {
    const order = runOrdinals([
      task({ id: "t-late", created_at: "2026-11-20T11:00:00Z" }),
      task({ id: "t-early", created_at: "2026-11-20T09:00:00Z" }),
    ]);
    expect(order.get("t-early")).toBe(1);
    expect(order.get("t-late")).toBe(2);
  });

  it("breaks a same-second tie by id so the order is stable", () => {
    const order = runOrdinals([
      task({ id: "t-b", created_at: "2026-11-20T09:00:00Z" }),
      task({ id: "t-a", created_at: "2026-11-20T09:00:00Z" }),
    ]);
    expect(order.get("t-a")).toBe(1);
    expect(order.get("t-b")).toBe(2);
  });
});

describe("preparingRun", () => {
  it("finds an active run this section just asked for", () => {
    const asked = task({ id: "t-asked", trigger_comment_id: "c-1", status: "queued" });
    expect(preparingRun([asked], new Set(["c-1"]))?.id).toBe("t-asked");
  });

  it("finds an active run whose summary carries the env start command", () => {
    const marker = task({
      id: "t-marker",
      status: "running",
      trigger_summary: "please run multica env start for web",
    });
    expect(preparingRun([marker], new Set())?.id).toBe("t-marker");
  });

  it("ignores a finished run even when it carried the marker", () => {
    const done = task({
      id: "t-done",
      status: "completed",
      trigger_summary: "multica env start",
    });
    expect(preparingRun([done], new Set())).toBeNull();
  });

  it("counts a deferred retry as still preparing", () => {
    // `deferred` is a retry parked until its backoff fires. Web's
    // ACTIVE_TASK_STATUSES includes it (`environment-model.ts`), and the row
    // is honest either way: the run WILL start the environment, just later.
    const deferred = task({
      id: "t-deferred",
      status: "deferred",
      trigger_summary: "multica env start",
    });
    expect(preparingRun([deferred], new Set())?.id).toBe("t-deferred");
  });
});

describe("declaredState", () => {
  const config: IssueEnvironmentConfig = {
    runtime_id: "runtime-1",
    task_id: "task-1",
    reported_at: "2026-11-20T10:00:00Z",
    can_control: true,
    environments: [{ repo: "org/app", name: "web", label: "Web", start: "pnpm dev" }],
  };

  it("reads `available` when nothing is up and nothing was asked", () => {
    expect(declaredState(config, config.environments[0]!, [], [])).toBe("available");
  });

  it("reads `running` when a live row matches", () => {
    expect(declaredState(config, config.environments[0]!, [env()], [])).toBe("running");
  });

  it("reads `starting` while the row is still coming up", () => {
    expect(
      declaredState(config, config.environments[0]!, [env({ state: "starting" })], []),
    ).toBe("starting");
  });

  it("reads `starting` when a restart is in flight on that row", () => {
    const restarting = env({ pending_action: record({ action: "restart", status: "pending" }) });
    expect(declaredState(config, config.environments[0]!, [restarting], [])).toBe(
      "starting",
    );
  });

  it("reads `starting` while this section's own start is unanswered", () => {
    const pendingStart = record({ status: "pending" });
    expect(declaredState(config, config.environments[0]!, [], [pendingStart])).toBe(
      "starting",
    );
  });

  it("ignores a start asked on another repo with the same name", () => {
    const otherRepo = record({ status: "pending", repo: "org/other" });
    expect(declaredState(config, config.environments[0]!, [], [otherRepo])).toBe(
      "available",
    );
  });
});

describe("rowCapabilities", () => {
  const online = { offline: false };

  it("lets a live, controllable, permitted row be stopped", () => {
    const caps = rowCapabilities(env(), online);
    expect(caps.canStop).toBe(true);
  });

  it("never offers a stop for an ended row", () => {
    expect(rowCapabilities(env({ ended_at: "2026-11-20T11:00:00Z" }), online).canStop).toBe(
      false,
    );
  });

  it("never offers any control while a command is pending", () => {
    const pending = env({ pending_action: record({ action: "restart", status: "pending" }) });
    const caps = rowCapabilities(pending, online);
    expect(caps.canStop).toBe(false);
    expect(caps.canRestart).toBe(false);
  });

  it("never offers control on an offline machine", () => {
    expect(rowCapabilities(env(), { offline: true }).canStop).toBe(false);
  });

  it("withholds control from a member without permission", () => {
    expect(rowCapabilities(env({ can_control: false }), online).canStop).toBe(false);
  });

  it("withholds control from a daemon too old to carry it out", () => {
    expect(rowCapabilities(env({ controllable: false }), online).canStop).toBe(false);
  });

  it("only restarts a declared environment", () => {
    expect(rowCapabilities(env({ source: "detected" }), online).canRestart).toBe(false);
    expect(rowCapabilities(env({ source: "config" }), online).canRestart).toBe(true);
  });

  it("reads logs for a declared environment but not a detected one", () => {
    expect(rowCapabilities(env({ source: "config" }), online).canReadLogs).toBe(true);
    expect(rowCapabilities(env({ source: "detected" }), online).canReadLogs).toBe(false);
  });

  it("opens only a live server row with a URL that is actually answering", () => {
    expect(rowCapabilities(env(), online).openable).toBe(true);
    expect(rowCapabilities(env({ state: "unreachable" }), online).openable).toBe(false);
    expect(rowCapabilities(env({ url: "" }), online).openable).toBe(false);
    expect(rowCapabilities(env({ kind: "app" }), online).openable).toBe(false);
  });
});

describe("rowAccess", () => {
  it("warns about a localhost URL that only opens on another machine", () => {
    const access = rowAccess({
      machine: { title: "build-box", isCurrent: false },
      offline: false,
      knowsLocal: true,
    });
    expect(access.localhostHint).toBe("environments.remoteHint");
  });

  it("says nothing about localhost when the row runs on this machine", () => {
    const access = rowAccess({
      machine: { title: "this-phone", isCurrent: true },
      offline: false,
      knowsLocal: true,
    });
    expect(access.localhostHint).toBeNull();
  });

  it("falls back to the generic localhost warning when the machine is unknown", () => {
    const access = rowAccess({ machine: null, offline: false, knowsLocal: true });
    expect(access.localhostHint).toBe("environments.localhostHint");
  });

  it("points an app row at Desktop on the machine that runs it", () => {
    const access = rowAccess({
      machine: { title: "studio", isCurrent: false },
      offline: false,
      knowsLocal: true,
    });
    expect(access.appHint).toBe("environments.appRemoteHint");
  });

  it("names the machine title when there is one", () => {
    const access = rowAccess({
      machine: { title: "build-box", isCurrent: false },
      offline: false,
      knowsLocal: false,
    });
    expect(access.machineTitle).toBe("build-box");
  });
});

describe("groupByMachine", () => {
  const machines = new Map([
    ["runtime-1", { machineId: "m-local", title: "laptop", isCurrent: true }],
    ["runtime-2", { machineId: "m-remote", title: "build-box", isCurrent: false }],
    ["runtime-3", { machineId: "m-remote", title: "build-box", isCurrent: false }],
  ]);
  const online = new Map([
    ["runtime-1", true],
    ["runtime-2", false],
    ["runtime-3", false],
  ]);

  const groups = (items: { runtime_id: string | null }[]) =>
    groupByMachine(items, {
      machineOf: (id) => (id ? (machines.get(id) ?? null) : null),
      isOffline: (id) => (id ? online.get(id) === false : false),
    });

  it("groups rows by the machine that runs them", () => {
    const built = groups([
      { runtime_id: "runtime-1" },
      { runtime_id: "runtime-2" },
      { runtime_id: "runtime-3" },
    ]);
    expect(built.map((g) => g.key)).toEqual(["m-local", "m-remote"]);
    expect(built[1]!.items).toHaveLength(2);
  });

  it("puts online machines before offline ones", () => {
    const built = groups([
      { runtime_id: "runtime-2" },
      { runtime_id: "runtime-1" },
    ]);
    expect(built[0]!.key).toBe("m-local");
  });

  it("groups an unknown runtime under one `unknown` bucket", () => {
    const built = groups([{ runtime_id: null }, { runtime_id: "runtime-gone" }]);
    expect(built).toHaveLength(1);
    expect(built[0]!.key).toBe("unknown");
    expect(built[0]!.items).toHaveLength(2);
  });

  it("does not label a group offline when its runtime is merely unknown", () => {
    // Web's `isOffline` is `!!runtimeId && runtimeOnline.get(id) === false`: a
    // runtime this member cannot see, or one this client has no row for, is
    // NOT known to be down. Marking it offline would claim a fact nobody
    // established — and would grey out actions that may well be possible.
    const built = groups([{ runtime_id: null }]);
    expect(built[0]!.offline).toBe(false);
  });

  it("marks a group offline only when every row in it is offline", () => {
    online.set("runtime-3", true);
    const built = groups([{ runtime_id: "runtime-2" }, { runtime_id: "runtime-3" }]);
    expect(built[0]!.offline).toBe(false);
    online.set("runtime-3", false);
  });
});

describe("sortRowItems", () => {
  it("keeps live rows ahead of pending starts and failures", () => {
    const items = [
      { kind: "failed" as const, id: "f" },
      { kind: "start" as const, id: "s" },
      { kind: "env" as const, id: "e" },
    ];
    expect(sortRowItems(items).map((i) => i.id)).toEqual(["e", "s", "f"]);
  });

  it("keeps pending starts ahead of failures", () => {
    const items = [
      { kind: "failed" as const, id: "f" },
      { kind: "start" as const, id: "s" },
    ];
    expect(sortRowItems(items).map((i) => i.id)).toEqual(["s", "f"]);
  });
});

describe("isLoopbackUrl / displayHost", () => {
  it("recognises every localhost spelling the server may send", () => {
    for (const url of [
      "http://localhost:3000",
      "http://app.localhost:3000",
      "http://127.0.0.1:8080",
      "http://0.0.0.0:8080",
      "http://[::1]:8080",
    ]) {
      expect(isLoopbackUrl(url)).toBe(true);
    }
  });

  it("does not call a public host loopback", () => {
    expect(isLoopbackUrl("https://mu.zztweb.top")).toBe(false);
  });

  it("treats an unparsable URL as not loopback rather than throwing", () => {
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("shows host + path, dropping a bare root path", () => {
    expect(displayHost("http://localhost:3000")).toBe("localhost:3000");
    expect(displayHost("http://localhost:3000/app")).toBe("localhost:3000/app");
  });

  it("returns null for an unparsable URL", () => {
    expect(displayHost("nope")).toBeNull();
  });
});

describe("environmentTitle", () => {
  it("uses the declared label", () => {
    expect(environmentTitle(env({ label: "Web app" }))).toBe("Web app");
  });

  it("falls back to the declared name when the label is empty", () => {
    expect(environmentTitle(env({ label: "", name: "web" }))).toBe("web");
  });

  it("shows a detected server by the address it answers on", () => {
    // A detected row has no declared label; the URL is the only thing a reader
    // recognises. The name is the daemon's internal key.
    expect(
      environmentTitle(
        env({ source: "detected", name: "key-9", label: "", url: "http://localhost:5173" }),
      ),
    ).toBe("localhost:5173");
  });

  it("keeps a detected app's name, since an app has no URL", () => {
    expect(
      environmentTitle(env({ source: "detected", kind: "app", name: "Figma", label: "", url: "" })),
    ).toBe("Figma");
  });
});

describe("environmentMeta", () => {
  // The meta line is returned as key + params rather than a finished string:
  // mobile's `t()` is a flat dictionary, and building the sentence here would
  // put a second copy of the wording (and the actor join) in the pure layer.
  const timeAgo = (iso: string) => `ago(${iso})`;
  const actorName = (r: IssueEnvironmentActionRecord) => (r.actor_id ? "Ada" : "Someone");
  const build = (e: IssueEnvironment, pending = pendingAction(e)) =>
    environmentMeta(e, pending, { timeAgo, actorName, now: NOW });

  it("says it is waiting for the machine while a stop is in flight", () => {
    expect(
      build(env({ pending_action: record({ action: "stop", status: "pending" }) })),
    ).toEqual({ key: "environments.waitingMachine" });
  });

  it("names who restarted it while the restart is in flight", () => {
    const meta = build(
      env({ pending_action: record({ action: "restart", status: "pending" }) }),
    );
    expect(meta).toEqual({
      key: "environments.restartedByWaiting",
      params: { name: "Ada" },
    });
  });

  it("reports an exit code for a crashed environment", () => {
    const meta = build(
      env({ state: "exited", ended_at: "2026-11-20T11:00:00Z", detail: "exit status 3" }),
      null,
    );
    expect(meta).toEqual({
      key: "environments.exitedWithCode",
      params: { time: "ago(2026-11-20T11:00:00Z)", code: 3 },
    });
  });

  it("names who stopped it", () => {
    const meta = build(
      env({
        state: "stopped",
        ended_at: "2026-11-20T11:00:00Z",
        last_action: record({ action: "stop", status: "succeeded" }),
      }),
      null,
    );
    expect(meta).toEqual({
      key: "environments.stoppedBy",
      params: { name: "Ada", time: "ago(2026-11-20T11:00:00Z)" },
    });
  });

  it("says an expired stop expired rather than naming a stopper", () => {
    expect(
      build(
        env({ state: "stopped", ended_at: "2026-11-20T11:00:00Z", detail: "expired" }),
        null,
      ),
    ).toEqual({ key: "environments.stoppedOnExpiry" });
  });

  it("reports the last time an unreachable row answered", () => {
    expect(
      build(env({ state: "unreachable", last_seen_at: "2026-11-20T11:30:00Z" }), null),
    ).toEqual({
      key: "environments.lastSeen",
      params: { time: "ago(2026-11-20T11:30:00Z)" },
    });
  });

  it("names who started a row that is still coming up", () => {
    expect(
      build(env({ state: "starting", origin: record({ action: "start" }) }), null),
    ).toEqual({ key: "environments.startedByWaiting", params: { name: "Ada" } });
  });

  it("counts down an expiry in the unit that reads best", () => {
    const at = (ms: number) => new Date(NOW + ms).toISOString();
    expect(build(env({ expires_at: at(20 * 60_000) }), null)).toEqual({
      key: "environments.expiresInMinutes",
      params: { count: 20 },
    });
    expect(build(env({ expires_at: at(5 * 60 * 60_000) }), null)).toEqual({
      key: "environments.expiresInHours",
      params: { count: 5 },
    });
    expect(build(env({ expires_at: at(5 * 24 * 60 * 60_000) }), null)).toEqual({
      key: "environments.expiresInDays",
      params: { count: 5 },
    });
  });

  it("never reports an expiry under a minute as zero", () => {
    // Rounding down to 0 would read "expires in 0m" — it is still running.
    expect(
      build(env({ expires_at: new Date(NOW + 5_000).toISOString() }), null),
    ).toEqual({ key: "environments.expiresInMinutes", params: { count: 1 } });
  });

  it("falls back to when it started", () => {
    expect(build(env(), null)).toEqual({
      key: "environments.startedAgo",
      params: { time: "ago(2026-11-20T10:00:00Z)" },
    });
  });
});

describe("classifyLogLines", () => {
  it("marks error lines and the indented lines continuing them", () => {
    expect(
      classifyLogLines(["ERROR failed to bind", "  at listen (server.js:1)", "ready"]),
    ).toEqual(["error", "error", null]);
  });

  it("recognises a panic and a Go error line", () => {
    expect(classifyLogLines(["panic: boom"])).toEqual(["error"]);
    expect(classifyLogLines(["Error: nope"])).toEqual(["error"]);
  });

  it("marks warnings", () => {
    expect(classifyLogLines(["WARN deprecated flag"])).toEqual(["warn"]);
  });

  it("does not carry a warning into the next line", () => {
    // Only an ERROR line claims its indented continuation; a warning does not,
    // because warnings rarely wrap and a false red would mislead the reader.
    expect(classifyLogLines(["WARN slow", "  plain indent"])).toEqual(["warn", null]);
  });
});
