/**
 * Machine grouping for the runtimes list (iteration-83, A2.4) — mirrors the
 * semantics of web `packages/views/runtimes/components/runtime-machines.ts`
 * plus `machineUpdateRuntime` (machine-cli-section.tsx) and the local
 * `formatDeviceInfo` / `buildWorkloadIndex` helpers the machine cards feed on.
 */
import { describe, expect, it } from "vitest";
import type { Agent, AgentRuntime, AgentTask } from "@multica/core/types";
import {
  buildRuntimeMachines,
  buildWorkloadIndex,
  filterRuntimeMachines,
  formatDeviceInfo,
  machineUpdateRuntime,
  runtimeMachineCounts,
  runtimeRowLabel,
  sharedCustomName,
  splitRuntimeName,
} from "./runtime-machines";

const NOW = new Date("2026-05-17T12:00:00Z").getTime();

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
    metadata: { cli_version: "0.3.0" },
    owner_id: "user-1",
    visibility: "private",
    last_seen_at: new Date(NOW - 10_000).toISOString(),
    created_at: "2026-05-17T11:00:00Z",
    updated_at: "2026-05-17T11:00:00Z",
    ...overrides,
  };
}

describe("runtime machine grouping", () => {
  it("groups multiple provider runtimes by daemon id", () => {
    const machines = buildRuntimeMachines(
      [
        makeRuntime({ id: "r1", provider: "claude" }),
        makeRuntime({ id: "r2", provider: "codex" }),
      ],
      { now: NOW },
    );
    expect(machines).toHaveLength(1);
    expect(machines[0]?.runtimes.map((r) => r.provider).sort()).toEqual([
      "claude",
      "codex",
    ]);
    expect(machines[0]?.providerNames).toEqual(["claude", "codex"]);
    expect(machines[0]?.onlineCount).toBe(2);
    expect(machines[0]?.issueCount).toBe(0);
  });

  it("uses the online daemon CLI version instead of a stale offline report", () => {
    const machines = buildRuntimeMachines(
      [
        makeRuntime({
          id: "r-old",
          status: "offline",
          metadata: { cli_version: "0.2.0" },
          last_seen_at: new Date(NOW - 3_600_000).toISOString(),
        }),
        makeRuntime({ id: "r-new", status: "online", metadata: { cli_version: "0.4.0" } }),
      ],
      { now: NOW },
    );
    expect(machines[0]?.cliVersion).toBe("0.4.0");
    expect(machines[0]?.launchedBy).toBeNull();
  });

  it("picks the newest report when nothing is online", () => {
    const machines = buildRuntimeMachines(
      [
        makeRuntime({
          id: "r-old",
          status: "offline",
          metadata: { cli_version: "0.2.0" },
          last_seen_at: new Date(NOW - 3_600_000).toISOString(),
        }),
        makeRuntime({
          id: "r-new",
          status: "offline",
          metadata: { cli_version: "0.4.0" },
          last_seen_at: new Date(NOW - 600_000).toISOString(),
        }),
      ],
      { now: NOW },
    );
    expect(machines[0]?.cliVersion).toBe("0.4.0");
  });

  it("uses a machine-wide custom name as the machine title, over the local name", () => {
    const machines = buildRuntimeMachines(
      [
        makeRuntime({
          custom_name: "Bohan's MacBook",
          name: "Claude (macbook.local)",
        }),
        makeRuntime({ id: "r2", custom_name: "Bohan's MacBook", name: "Codex (macbook.local)" }),
      ],
      { now: NOW, localMachineName: "some-other" },
    );
    expect(machines[0]?.title).toBe("Bohan's MacBook");
    expect(machines[0]?.subtitle).not.toContain("Bohan's MacBook");
  });

  it("ignores a one-off per-runtime custom name for the machine title", () => {
    const machines = buildRuntimeMachines(
      [
        makeRuntime({ custom_name: "personal alias" }),
        makeRuntime({ id: "r2", custom_name: undefined }),
      ],
      { now: NOW },
    );
    expect(machines[0]?.title).not.toBe("personal alias");
  });

  it("counts machines with any offline runtime as issues", () => {
    const machines = buildRuntimeMachines(
      [
        makeRuntime({ id: "r-online" }),
        makeRuntime({ id: "r-offline", status: "offline" }),
      ],
      { now: NOW },
    );
    expect(machines[0]?.onlineCount).toBe(1);
    expect(machines[0]?.issueCount).toBe(1);
    expect(machines[0]?.health).toBe("online");
  });

  it("reports the worst non-online health when nothing is online", () => {
    const machines = buildRuntimeMachines(
      [makeRuntime({ status: "offline", last_seen_at: new Date(NOW - 7 * 86_400_000).toISOString() })],
      { now: NOW },
    );
    expect(machines[0]?.health).toBe("about_to_gc");
  });

  it("does not surface agent CLI version branding as the machine subtitle", () => {
    const machines = buildRuntimeMachines(
      [makeRuntime({ device_info: "dev-machine.local · claude 2.1.5 (Claude Code)" })],
      { now: NOW },
    );
    const subtitle = machines[0]?.subtitle;
    if (subtitle) {
      expect(subtitle.toLowerCase()).not.toContain("claude code");
      expect(subtitle).not.toMatch(/\d+\.\d+\.\d+/);
    }
  });

  it("runs a cloud runtime without a daemon as a cloud worker machine", () => {
    const machines = buildRuntimeMachines(
      [
        makeRuntime({
          id: "cloud-1",
          daemon_id: null,
          runtime_mode: "cloud",
          name: "Claude cloud",
          device_info: "Cloud worker · linux-amd64",
        }),
      ],
      { now: NOW },
    );
    expect(machines[0]?.section).toBe("cloud");
    expect(machines[0]?.title).toContain("Cloud");
  });

  it("keeps an unsuffixed remote runtime grouped by daemon device name", () => {
    const machines = buildRuntimeMachines(
      [
        makeRuntime({ name: "Claude", device_info: "dev-machine.local · claude 1.0.0" }),
        makeRuntime({ id: "r2", name: "Codex", device_info: "dev-machine.local · codex 1.0.0" }),
      ],
      { now: NOW },
    );
    expect(machines).toHaveLength(1);
  });

  it("does not claim another user's identically-named machine as current", () => {
    const machines = buildRuntimeMachines(
      [
        makeRuntime({
          id: "r-other",
          owner_id: "user-other",
          name: "Claude (work.local)",
        }),
      ],
      { now: NOW, localDaemonId: "daemon-mine", localMachineName: "work.local", currentUserId: "user-mine" },
    );
    expect(machines[0]?.isCurrent).toBe(false);
    expect(machines[0]?.section).toBe("remote");
  });

  it("sorts current-machine first, then local/remote/cloud, online first, then title", () => {
    const machines = buildRuntimeMachines(
      [
        makeRuntime({ id: "r-cloud", daemon_id: "d2", runtime_mode: "cloud", name: "Z cloud" }),
        makeRuntime({ id: "r-local-b", daemon_id: "daemon-2", name: "Claude (b.local)", status: "offline" }),
        makeRuntime({ id: "r-remote", daemon_id: "d3", name: "Codex (remote.local)", status: "offline" }),
        makeRuntime({ id: "r-local-a", name: "Claude (a.local)" }),
      ],
      { now: NOW, localDaemonId: "daemon-1", localMachineName: "a.local", currentUserId: "user-1" },
    );
    // Non-current local daemons fold into the remote section, exactly as
    // web does — only the viewing user's own machine reads "local".
    expect(machines.map((m) => m.section)).toEqual([
      "local",
      "remote",
      "remote",
      "cloud",
    ]);
    expect(machines[0]?.isCurrent).toBe(true);
    // Current first; the online local machine (a.local) beats the offline
    // local daemon (b.local) inside the remote section on onlineCount.
    expect(machines[0]?.title.toLowerCase()).toContain("a.local");
    expect(machines[1]?.title.toLowerCase()).toContain("b.local");
    expect(machines[1]?.onlineCount).toBe(0);
  });
});

describe("splitRuntimeName", () => {
  it("separates daemon host suffix from provider name", () => {
    expect(splitRuntimeName("Claude (dev-machine.local)")).toEqual({
      base: "Claude",
      hostname: "dev-machine.local",
    });
  });

  it("falls back to the full name when no host suffix exists", () => {
    expect(splitRuntimeName("Claude")).toEqual({ base: "Claude", hostname: null });
  });
});

describe("sharedCustomName", () => {
  it("returns the name when every runtime shares one non-empty custom_name", () => {
    expect(
      sharedCustomName([
        makeRuntime({ custom_name: "Box" }),
        makeRuntime({ id: "r2", custom_name: "Box" }),
      ]),
    ).toBe("Box");
  });

  it("returns null when only some runtimes are named", () => {
    expect(
      sharedCustomName([
        makeRuntime({ custom_name: "Box" }),
        makeRuntime({ id: "r2" }),
      ]),
    ).toBeNull();
  });

  it("returns null when the names disagree or the set is empty", () => {
    expect(sharedCustomName([])).toBeNull();
    expect(
      sharedCustomName([
        makeRuntime({ custom_name: "Box" }),
        makeRuntime({ id: "r2", custom_name: "Other" }),
      ]),
    ).toBeNull();
  });
});

describe("runtimeRowLabel", () => {
  it("falls back to the provider base when no alias is set", () => {
    expect(runtimeRowLabel(makeRuntime({}), "dev-machine")).toBe("Claude");
  });

  it("collapses a machine-level alias (shared with the title) to the base", () => {
    expect(runtimeRowLabel(makeRuntime({ custom_name: "Box" }), "Box")).toBe("Claude");
  });

  it("shows a per-runtime alias that differs from the machine title", () => {
    expect(runtimeRowLabel(makeRuntime({ custom_name: "Alias" }), "Box")).toBe("Alias");
  });
});

describe("filterRuntimeMachines / counts", () => {
  const machines = buildRuntimeMachines(
    [
      makeRuntime({ id: "r-a", name: "Claude (dev.local)" }),
      makeRuntime({ id: "r-b", daemon_id: "d3", name: "Codex (dev2.local)", status: "offline" }),
      makeRuntime({ id: "r-c", daemon_id: "d2", runtime_mode: "cloud", name: "Claude cloud" }),
    ],
    { now: NOW },
  );

  it("counts machines per filter bucket", () => {
    expect(runtimeMachineCounts(machines)).toEqual({ all: 3, online: 2, issues: 1 });
  });

  it("filters by online and issues", () => {
    expect(filterRuntimeMachines(machines, "", "online")).toHaveLength(2);
    expect(filterRuntimeMachines(machines, "", "issues")).toHaveLength(1);
    expect(filterRuntimeMachines(machines, "", "all")).toHaveLength(3);
  });

  it("matches a search query across title/daemon/provider names", () => {
    expect(filterRuntimeMachines(machines, "dev.local", "all")).toHaveLength(1);
    expect(filterRuntimeMachines(machines, "cloud", "all")).toHaveLength(1);
    expect(filterRuntimeMachines(machines, "nope", "all")).toHaveLength(0);
  });
});

describe("formatDeviceInfo", () => {
  it("rewrites the OS/arch suffix while preserving the hostname", () => {
    expect(formatDeviceInfo("MacBook-Pro · darwin-amd64")).toBe(
      "MacBook-Pro · macOS (amd64)",
    );
    expect(formatDeviceInfo("some-host · linux-arm64")).toBe(
      "some-host · Linux (arm64)",
    );
  });

  it("leaves unknown parts untouched and nulls empty input", () => {
    expect(formatDeviceInfo(null)).toBeNull();
    expect(formatDeviceInfo("  ")).toBeNull();
    expect(formatDeviceInfo("just-a-host")).toBe("just-a-host");
  });
});

describe("machineUpdateRuntime", () => {
  const machine = buildRuntimeMachines(
    [
      makeRuntime({ id: "r-online", owner_id: "user-1", status: "online" }),
      makeRuntime({ id: "r-offline", owner_id: "user-2", status: "offline" }),
    ],
    { now: NOW },
  )[0]!;

  it("lets a workspace admin use any runtime, online first", () => {
    expect(machineUpdateRuntime(machine, "user-1", true)?.id).toBe("r-online");
  });

  it("scopes a non-admin to their own runtimes, online first", () => {
    expect(machineUpdateRuntime(machine, "user-2", false)?.id).toBe("r-offline");
  });

  it("returns null for a non-admin viewer who owns no runtime", () => {
    expect(machineUpdateRuntime(machine, "user-3", false)).toBeNull();
  });

  it("returns null when the viewer id is unknown and not an admin", () => {
    expect(machineUpdateRuntime(machine, undefined, false)).toBeNull();
  });

  it("never selects a command channel on a non-local machine", () => {
    const cloud = buildRuntimeMachines(
      [makeRuntime({ id: "c1", daemon_id: null, runtime_mode: "cloud", name: "Claude cloud" })],
      { now: NOW },
    )[0]!;
    expect(machineUpdateRuntime(cloud, "user-1", true)).toBeNull();
  });
});

describe("buildWorkloadIndex", () => {
  const agents: Agent[] = [
    {
      id: "a1",
      workspace_id: "ws-1",
      runtime_id: "r1",
      name: "Agent 1",
      profile: "",
      instructions: "",
      mode: "default",
    } as unknown as Agent,
    {
      id: "a2",
      workspace_id: "ws-1",
      runtime_id: "r1",
      name: "Agent 2",
      profile: "",
      instructions: "",
      mode: "default",
    } as unknown as Agent,
    {
      id: "a-archived",
      runtime_id: "r9",
      archived_at: "2026-05-01T00:00:00Z",
    } as unknown as Agent,
  ];
  const tasks: AgentTask[] = [
    { agent_id: "a1", status: "running" } as AgentTask,
    { agent_id: "a2", status: "queued" } as AgentTask,
    { agent_id: "a2", status: "dispatched" } as AgentTask,
    { agent_id: "a-archived", status: "running" } as AgentTask,
  ];

  it("sums running/queued per runtime, skipping archived agents", () => {
    const index = buildWorkloadIndex(agents, tasks);
    expect(index.get("r1")).toEqual({ runningCount: 1, queuedCount: 2 });
    expect(index.has("r9")).toBe(false);
  });
});