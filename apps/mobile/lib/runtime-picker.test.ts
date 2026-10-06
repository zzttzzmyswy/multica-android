/**
 * Unit tests for the agent-create runtime picker logic (lib/runtime-picker.ts).
 *
 * Mobile's vitest lane is Node-only (no RN renderer), so this drives the pure
 * module the sheet renders from. The behaviours pinned here are the ones that
 * regressed in the shipped sheet and the ones a source-level guard cannot
 * express: scope membership, search granularity, and — most importantly — the
 * default selection after a scope toggle, which must always land on a runtime
 * the create gate accepts.
 */
import { describe, expect, it } from "vitest";
import type { RuntimeDevice } from "@multica/core/types";
import {
  RUNTIME_SEARCH_THRESHOLD,
  computeFilteredRuntimes,
  firstUsableRuntimeId,
  hasOtherRuntimes,
  isRuntimeRowLocked,
  pickerEmptyState,
  pickerMachines,
} from "./runtime-picker";

const NOW = new Date("2026-10-06T12:00:00Z").getTime();
const ME = "user-me";
const OTHER = "user-other";

function runtime(
  id: string,
  overrides: Partial<RuntimeDevice> = {},
): RuntimeDevice {
  return {
    id,
    workspace_id: "ws-1",
    daemon_id: `daemon-${id}`,
    name: `Claude (${id}.local)`,
    runtime_mode: "local",
    provider: "claude",
    launch_header: "",
    status: "online",
    device_info: `${id}.local · claude 1.0.0`,
    metadata: {},
    owner_id: ME,
    visibility: "private",
    last_seen_at: new Date(NOW - 5_000).toISOString(),
    created_at: "2026-10-06T11:00:00Z",
    updated_at: "2026-10-06T11:00:00Z",
    ...overrides,
  };
}

describe("hasOtherRuntimes", () => {
  it("is false when the viewer owns every runtime (tabs would do nothing)", () => {
    expect(hasOtherRuntimes([runtime("r1"), runtime("r2")], ME)).toBe(false);
  });

  it("is true when somebody else's runtime is present", () => {
    expect(
      hasOtherRuntimes(
        [runtime("r1"), runtime("r2", { owner_id: OTHER, visibility: "public" })],
        ME,
      ),
    ).toBe(true);
  });

  it("counts an ownerless runtime as switchable-away-from", () => {
    // owner_id null !== ME, so the tabs appear — matching web exactly.
    expect(hasOtherRuntimes([runtime("r1"), runtime("r2", { owner_id: null })], ME)).toBe(
      true,
    );
  });
});

describe("computeFilteredRuntimes", () => {
  const mine = runtime("r-mine");
  const theirsPublic = runtime("r-public", {
    owner_id: OTHER,
    visibility: "public",
  });
  const theirsPrivate = runtime("r-private", {
    owner_id: OTHER,
    visibility: "private",
  });
  const list = [theirsPublic, mine, theirsPrivate];

  it("Mine keeps only the viewer's own runtimes", () => {
    expect(
      computeFilteredRuntimes(list, "mine", ME).map((r) => r.id),
    ).toEqual(["r-mine"]);
  });

  it("All keeps every runtime, including locked and ownerless ones", () => {
    expect(computeFilteredRuntimes(list, "all", ME).map((r) => r.id).sort()).toEqual(
      ["r-mine", "r-private", "r-public"],
    );
  });

  it("orders own-first, then usable-first, without dropping anything", () => {
    const ordered = computeFilteredRuntimes(list, "all", ME);
    expect(ordered[0]?.id).toBe("r-mine");
    // r-public (usable) precedes r-private (locked), both still present.
    expect(ordered.map((r) => r.id)).toEqual([
      "r-mine",
      "r-public",
      "r-private",
    ]);
  });

  it("All is not a filter for an unknown viewer — nothing is own-scoped", () => {
    expect(computeFilteredRuntimes(list, "all", null)).toHaveLength(3);
  });

  it("does not mutate the caller's array", () => {
    const input = [theirsPrivate, mine];
    const snapshot = input.map((r) => r.id);
    computeFilteredRuntimes(input, "all", ME);
    expect(input.map((r) => r.id)).toEqual(snapshot);
  });
});

describe("firstUsableRuntimeId", () => {
  it("picks a runtime the create gate accepts (online AND usable)", () => {
    const list = [
      runtime("r-offline-mine", { status: "offline" }),
      runtime("r-locked", { owner_id: OTHER, visibility: "private" }),
      runtime("r-good", { owner_id: OTHER, visibility: "public" }),
    ];
    expect(firstUsableRuntimeId(list, ME)).toBe("r-good");
  });

  it("returns null when the scope holds no runnable runtime", () => {
    const list = [runtime("r-offline", { status: "offline" })];
    expect(firstUsableRuntimeId(list, ME)).toBeNull();
  });

  it("returns null for an ownerless runtime (server cannot mint a token)", () => {
    expect(firstUsableRuntimeId([runtime("r-orphan", { owner_id: null })], ME)).toBeNull();
  });

  it("never selects a locked runtime even when it sorts first", () => {
    const list = [
      runtime("r-locked-first", { owner_id: OTHER, visibility: "private" }),
      runtime("r-mine"),
    ];
    const scoped = computeFilteredRuntimes(list, "all", ME);
    expect(scoped[0]?.id).toBe("r-mine");
    expect(firstUsableRuntimeId(scoped, ME)).toBe("r-mine");
  });
});

describe("isRuntimeRowLocked", () => {
  it("locks somebody else's private runtime", () => {
    expect(
      isRuntimeRowLocked(
        runtime("r", { owner_id: OTHER, visibility: "private" }),
        ME,
      ),
    ).toBe(true);
  });

  it("does not lock a public runtime owned by somebody else", () => {
    expect(
      isRuntimeRowLocked(runtime("r", { owner_id: OTHER, visibility: "public" }), ME),
    ).toBe(false);
  });

  it("does not lock the viewer's own OFFLINE runtime (edit must stay re-choosable)", () => {
    expect(isRuntimeRowLocked(runtime("r", { status: "offline" }), ME)).toBe(false);
  });

  it("locks an ownerless runtime", () => {
    expect(isRuntimeRowLocked(runtime("r", { owner_id: null }), ME)).toBe(true);
  });
});

describe("pickerMachines", () => {
  const list = [
    runtime("r-a", { name: "Claude (alpha.local)", daemon_id: "d-alpha" }),
    runtime("r-b", { name: "Codex (beta.local)", daemon_id: "d-beta", provider: "codex" }),
    runtime("r-c", { name: "Claude (gamma.local)", daemon_id: "d-gamma" }),
  ];

  it("groups one machine per daemon", () => {
    const machines = pickerMachines(list, {
      filter: "all",
      search: "",
      currentUserId: ME,
      now: NOW,
    });
    expect(machines.map((m) => m.title).sort()).toEqual([
      "alpha.local",
      "beta.local",
      "gamma.local",
    ]);
  });

  it("search narrows to matching machines and keeps the group whole", () => {
    const machines = pickerMachines(
      [
        runtime("r-a", { daemon_id: "d-alpha", name: "Claude (alpha.local)" }),
        runtime("r-b", {
          daemon_id: "d-alpha",
          name: "Codex (alpha.local)",
          provider: "codex",
        }),
        runtime("r-c", { daemon_id: "d-gamma", name: "Claude (gamma.local)" }),
      ],
      { filter: "all", search: "alpha", currentUserId: ME, now: NOW },
    );
    expect(machines).toHaveLength(1);
    // Both runtimes of the matched machine survive — search is machine-level.
    expect(machines[0]?.runtimes.map((r) => r.id).sort()).toEqual(["r-a", "r-b"]);
  });

  it("returns nothing (not everything) when the search matches no machine", () => {
    const machines = pickerMachines(list, {
      filter: "all",
      search: "no-such-machine",
      currentUserId: ME,
      now: NOW,
    });
    expect(machines).toEqual([]);
  });

  it("honours the scope before grouping", () => {
    const machines = pickerMachines(
      [
        runtime("r-mine", { daemon_id: "d-mine", owner_id: ME }),
        runtime("r-theirs", { daemon_id: "d-theirs", owner_id: OTHER, visibility: "public" }),
      ],
      { filter: "mine", search: "", currentUserId: ME, now: NOW },
    );
    expect(machines.flatMap((m) => m.runtimes.map((r) => r.id))).toEqual(["r-mine"]);
  });

  it("counts online runtimes per machine for the section header", () => {
    const machines = pickerMachines(
      [
        runtime("r-on", { daemon_id: "d-x", status: "online" }),
        runtime("r-off", { daemon_id: "d-x", status: "offline" }),
      ],
      { filter: "all", search: "", currentUserId: ME, now: NOW },
    );
    expect(machines[0]?.onlineCount).toBe(1);
    expect(machines[0]?.runtimes).toHaveLength(2);
  });

  it("keeps locked runtimes in the rendered machines (web parity)", () => {
    const machines = pickerMachines(
      [runtime("r-theirs", { owner_id: OTHER, visibility: "private" })],
      { filter: "all", search: "", currentUserId: ME, now: NOW },
    );
    expect(machines.flatMap((m) => m.runtimes.map((r) => r.id))).toEqual(["r-theirs"]);
  });
});

describe("RUNTIME_SEARCH_THRESHOLD", () => {
  it("matches web's SEARCH_THRESHOLD", () => {
    expect(RUNTIME_SEARCH_THRESHOLD).toBe(6);
  });
});

describe("pickerEmptyState", () => {
  const one = [runtime("r1")];

  it("is null whenever something is rendered", () => {
    const machines = pickerMachines(one, {
      filter: "all",
      search: "",
      currentUserId: ME,
      now: NOW,
    });
    expect(pickerEmptyState(one, machines, "")).toBeNull();
  });

  it("names the empty workspace, not a failed search", () => {
    expect(pickerEmptyState([], [], "")).toBe("none");
  });

  it("names a search that matched nothing", () => {
    expect(pickerEmptyState(one, [], "zzz")).toBe("search");
  });

  it("names an empty scope so the message can point at the toggle", () => {
    // Mine is empty for a member who owns nothing — the sheet opens here.
    expect(pickerEmptyState(one, [], "")).toBe("scope");
  });

  it("treats a whitespace-only query as no query at all", () => {
    expect(pickerEmptyState(one, [], "   ")).toBe("scope");
  });
});

describe("scope toggle re-selection (the silent break)", () => {
  // The behaviour web calls out explicitly: switching scope re-selects the
  // first USABLE runtime of the new scope. Landing on a locked row would leave
  // the form unsubmittable with no visible cause.
  const list = [
    runtime("r-mine"),
    runtime("r-theirs-public", { owner_id: OTHER, visibility: "public" }),
    runtime("r-theirs-private", { owner_id: OTHER, visibility: "private" }),
  ];

  it("lands on a usable runtime of the new scope, never a locked one", () => {
    const all = computeFilteredRuntimes(list, "all", ME);
    const picked = firstUsableRuntimeId(all, ME);
    expect(picked).toBe("r-mine");
    const chosen = all.find((r) => r.id === picked);
    expect(chosen && isRuntimeRowLocked(chosen, ME)).toBe(false);
  });

  it("Mine always resolves to one of the viewer's own runtimes", () => {
    const mine = computeFilteredRuntimes(list, "mine", ME);
    expect(firstUsableRuntimeId(mine, ME)).toBe("r-mine");
  });

  it("returns null (keep the current pick) when the scope has nothing runnable", () => {
    const theirsOnly = [
      runtime("r-x", { owner_id: OTHER, visibility: "private" }),
    ];
    expect(firstUsableRuntimeId(computeFilteredRuntimes(theirsOnly, "mine", ME), ME)).toBeNull();
  });

  it("never picks an offline runtime even when it is the viewer's own", () => {
    const offline = [runtime("r-off", { status: "offline" })];
    expect(firstUsableRuntimeId(offline, ME)).toBeNull();
  });
});
