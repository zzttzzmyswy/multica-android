/**
 * Machine-detail runtime row facts (iteration 167) — the per-row content web's
 * `RuntimeList` prints in its Owner / Agents / Cost / CLI columns, ported to a
 * phone row. Web counterpart:
 * `packages/views/runtimes/components/runtime-list.tsx` (showOwner, CliCell,
 * CostCell, HealthCell's load suffix).
 *
 * The load-bearing decisions here are the ones a reader would get wrong by
 * guessing: the Owner column is hidden unless it distinguishes rows, the CLI
 * column carries the *agent* CLI (`metadata.version`), not the machine-wide
 * daemon CLI (`metadata.cli_version`) that every runtime on a machine shares,
 * and the cost window is end-exclusive of today.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntime, MemberWithUser, RuntimeUsage } from "@multica/core/types";
import {
  RUNTIME_COST_FETCH_DAYS,
  RUNTIME_COST_WINDOW_DAYS,
  runtimeActiveTaskCount,
  runtimeCliVersion,
  runtimeCostCell,
  runtimeOwnerName,
  showRuntimeLoadSuffix,
  showRuntimeOwnerColumn,
} from "./runtime-row-facts";

function makeRuntime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    id: "runtime-1",
    workspace_id: "ws-1",
    daemon_id: "daemon-1",
    name: "Claude (dev-machine.local)",
    runtime_mode: "local",
    provider: "claude",
    launch_header: "",
    status: "online",
    device_info: "dev-machine.local · claude 1.0.0",
    metadata: {},
    owner_id: "user-1",
    visibility: "private",
    last_seen_at: "2026-05-17T11:59:00Z",
    created_at: "2026-05-17T11:00:00Z",
    updated_at: "2026-05-17T11:00:00Z",
    ...overrides,
  };
}

function makeMember(userId: string, name: string): MemberWithUser {
  return {
    id: `member-${userId}`,
    workspace_id: "ws-1",
    user_id: userId,
    role: "member",
    created_at: "2026-01-01T00:00:00Z",
    name,
    email: `${userId}@example.com`,
    avatar_url: null,
  };
}

describe("showRuntimeOwnerColumn", () => {
  it("hides the owner column when every runtime has the same owner", () => {
    // Web's rule: a column of identical avatars is noise. This is the normal
    // case on a machine page — one person owns the daemon's runtimes.
    expect(
      showRuntimeOwnerColumn([
        makeRuntime({ id: "r1", owner_id: "user-1" }),
        makeRuntime({ id: "r2", owner_id: "user-1" }),
      ]),
    ).toBe(false);
  });

  it("shows the owner column once two distinct owners are present", () => {
    expect(
      showRuntimeOwnerColumn([
        makeRuntime({ id: "r1", owner_id: "user-1" }),
        makeRuntime({ id: "r2", owner_id: "user-2" }),
      ]),
    ).toBe(true);
  });

  it("ignores unowned runtimes when counting owners", () => {
    // An orphan runtime (owner_id null) prints "—" on web and must not be
    // mistaken for a second owner.
    expect(
      showRuntimeOwnerColumn([
        makeRuntime({ id: "r1", owner_id: "user-1" }),
        makeRuntime({ id: "r2", owner_id: null }),
      ]),
    ).toBe(false);
  });

  it("hides the column for an empty or single-runtime machine", () => {
    expect(showRuntimeOwnerColumn([])).toBe(false);
    expect(showRuntimeOwnerColumn([makeRuntime({ owner_id: "user-1" })])).toBe(
      false,
    );
  });
});

describe("runtimeOwnerName", () => {
  const members = [makeMember("user-1", "Alice"), makeMember("user-2", "Bob")];

  it("resolves the owner's display name", () => {
    expect(runtimeOwnerName(makeRuntime({ owner_id: "user-2" }), members)).toBe(
      "Bob",
    );
  });

  it("returns null for an unowned runtime and for an owner no longer in the workspace", () => {
    expect(runtimeOwnerName(makeRuntime({ owner_id: null }), members)).toBeNull();
    expect(
      runtimeOwnerName(makeRuntime({ owner_id: "user-gone" }), members),
    ).toBeNull();
  });
});

describe("runtimeCliVersion", () => {
  it("reads the agent CLI version off metadata.version", () => {
    expect(
      runtimeCliVersion(makeRuntime({ metadata: { version: "2.1.5 (Claude Code)" } })),
    ).toBe("2.1.5 (Claude Code)");
  });

  it("ignores the machine-wide daemon cli_version", () => {
    // MUL-3838: cli_version is the shared multica daemon CLI, identical for
    // every runtime on one machine — surfacing it per row made every agent
    // show the same number. It belongs to the machine header, not the row.
    expect(
      runtimeCliVersion(makeRuntime({ metadata: { cli_version: "0.3.0" } })),
    ).toBeNull();
  });

  it("returns null for a missing, blank or non-string version", () => {
    expect(runtimeCliVersion(makeRuntime({ metadata: {} }))).toBeNull();
    expect(runtimeCliVersion(makeRuntime({ metadata: { version: "  " } }))).toBeNull();
    expect(runtimeCliVersion(makeRuntime({ metadata: { version: 42 } }))).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(runtimeCliVersion(makeRuntime({ metadata: { version: " 0.118.0 " } }))).toBe(
      "0.118.0",
    );
  });
});

describe("runtimeActiveTaskCount / showRuntimeLoadSuffix", () => {
  it("counts running plus queued work", () => {
    expect(runtimeActiveTaskCount({ agentIds: [], runningCount: 2, queuedCount: 3 })).toBe(5);
  });

  it("treats a runtime with no workload entry as idle", () => {
    expect(runtimeActiveTaskCount(undefined)).toBe(0);
  });

  it("prints the load suffix only for a live runtime with work in flight", () => {
    // Mirrors web HealthCell: idle is the unremarkable default, and an
    // offline-ish row already says everything the count would.
    expect(showRuntimeLoadSuffix("online", 2)).toBe(true);
    expect(showRuntimeLoadSuffix("recently_lost", 1)).toBe(true);
    expect(showRuntimeLoadSuffix("online", 0)).toBe(false);
    expect(showRuntimeLoadSuffix("offline", 3)).toBe(false);
    expect(showRuntimeLoadSuffix("about_to_gc", 3)).toBe(false);
  });
});

describe("runtimeCostCell", () => {
  // claude-sonnet-4-6 is priced at $3 / 1M input tokens, so a row carrying
  // exactly 1M input tokens contributes $3.
  function priced(date: string, inputTokens: number): RuntimeUsage {
    return {
      runtime_id: "runtime-1",
      date,
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: inputTokens,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches 14 days so a 7d total and its prior 7d delta share one request", () => {
    expect(RUNTIME_COST_WINDOW_DAYS).toBe(7);
    expect(RUNTIME_COST_FETCH_DAYS).toBe(14);
  });

  it("renders a dash only when the runtime reported no usage at all", () => {
    // Web checks the FETCHED rows, not the sliced window: the dash means "this
    // runtime has no usage", so rows that exist but fall outside the 7 days
    // still total to $0.00 rather than disappearing behind a dash.
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    expect(runtimeCostCell([], "UTC")).toEqual({ kind: "none" });
    const stale = runtimeCostCell([priced("2026-01-01", 1_000_000)], "UTC");
    if (stale.kind !== "cost") throw new Error("expected a cost cell");
    expect(stale.amount).toBe(0);
    expect(stale.label).toBe("$0.00");
  });

  it("sums the trailing 7 days, end-exclusive of today, and labels in dollars", () => {
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    const cell = runtimeCostCell(
      [
        priced("2026-05-12", 1_000_000), // before window — excluded
        priced("2026-05-13", 1_000_000), // window start — included
        priced("2026-05-19", 1_000_000), // included
        priced("2026-05-20", 1_000_000), // today — excluded
      ],
      "UTC",
    );
    expect(cell.kind).toBe("cost");
    if (cell.kind !== "cost") return;
    expect(cell.amount).toBeCloseTo(6, 5);
    expect(cell.label).toBe("$6.00");
  });

  it("drops the cents once the total reaches $100", () => {
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    const cell = runtimeCostCell([priced("2026-05-19", 40_000_000)], "UTC");
    if (cell.kind !== "cost") throw new Error("expected a cost cell");
    expect(cell.amount).toBeCloseTo(120, 5);
    expect(cell.label).toBe("$120");
  });

  it("reads 'today' in the viewer's timezone, not the host clock", () => {
    // Host clock is 2026-05-19 in UTC but already 05-20 in Shanghai. The
    // 05-19 row sits inside the 7d window only when the viewer's zone pushes
    // "today" forward — and the window is end-exclusive, so UTC drops it.
    vi.setSystemTime(new Date("2026-05-19T23:00:00Z"));
    const rows = [priced("2026-05-19", 1_000_000)];
    const utc = runtimeCostCell(rows, "UTC");
    const shanghai = runtimeCostCell(rows, "Asia/Shanghai");
    if (utc.kind !== "cost" || shanghai.kind !== "cost") {
      throw new Error("expected cost cells");
    }
    expect(utc.amount).toBe(0);
    expect(shanghai.amount).toBeCloseTo(3, 5);
  });

  it("tones a rise as warning and a fall as success", () => {
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    const rows = [
      priced("2026-05-19", 1_000_000), // current window: $3
      priced("2026-05-12", 2_000_000), // prior window: $6
    ];
    const cell = runtimeCostCell(rows, "UTC");
    if (cell.kind !== "cost") throw new Error("expected a cost cell");
    expect(cell.delta).toBe(-50);
    expect(cell.tone).toBe("success");

    const rising = runtimeCostCell(
      [priced("2026-05-19", 2_000_000), priced("2026-05-12", 1_000_000)],
      "UTC",
    );
    if (rising.kind !== "cost") throw new Error("expected a cost cell");
    expect(rising.delta).toBe(100);
    expect(rising.tone).toBe("warning");
  });

  it("has no delta — and a muted tone — when the prior window was empty", () => {
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    const cell = runtimeCostCell([priced("2026-05-19", 1_000_000)], "UTC");
    if (cell.kind !== "cost") throw new Error("expected a cost cell");
    expect(cell.delta).toBeNull();
    expect(cell.tone).toBe("muted");
  });

  it("flattens a zero-percent move to a muted zero delta", () => {
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    const cell = runtimeCostCell(
      [priced("2026-05-19", 1_000_000), priced("2026-05-12", 1_000_000)],
      "UTC",
    );
    if (cell.kind !== "cost") throw new Error("expected a cost cell");
    expect(cell.delta).toBe(0);
    expect(cell.tone).toBe("muted");
  });
});
