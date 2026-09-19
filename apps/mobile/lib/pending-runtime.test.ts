import { describe, expect, it } from "vitest";
import type { AgentRuntime, RuntimeProfile } from "@multica/core/types";
import type { RuntimeMachine } from "./runtime-machines";
import {
  PENDING_RUNTIME_WARNING_MS,
  customRuntimeRegistrationFailure,
  isDisabledCustomRuntime,
  isPendingCustomRuntime,
  isPendingCustomRuntimeWarning,
  orphanProfileRuntimes,
  pendingRuntimeCommandName,
  pendingRuntimeFromProfile,
  pendingRuntimeId,
} from "./pending-runtime";

function profile(overrides: Partial<RuntimeProfile> = {}): RuntimeProfile {
  return {
    id: "profile-1",
    workspace_id: "ws-1",
    display_name: "Team Codex",
    protocol_family: "codex",
    command_name: "team-codex",
    description: null,
    fixed_args: [],
    visibility: "workspace",
    created_by: "user-1",
    enabled: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function runtime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    id: "runtime-1",
    workspace_id: "ws-1",
    daemon_id: "daemon-1",
    name: "Codex (MacBook)",
    runtime_mode: "cloud",
    provider: "codex",
    launch_header: "codex",
    status: "online",
    device_info: "MacBook",
    metadata: {},
    owner_id: "user-1",
    visibility: "private",
    profile_id: null,
    last_seen_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function machine(overrides: Partial<RuntimeMachine> = {}): RuntimeMachine {
  return {
    id: "cloud:device:worker-1",
    daemonId: null,
    title: "Cloud worker",
    subtitle: null,
    deviceInfo: null,
    cliVersion: null,
    launchedBy: null,
    mode: "cloud",
    section: "cloud",
    isCurrent: false,
    health: "online",
    runtimes: [runtime()],
    onlineCount: 1,
    issueCount: 0,
    runningCount: 0,
    queuedCount: 0,
    providerNames: ["codex"],
    lastSeenAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("pending custom runtime rows", () => {
  it("builds an offline placeholder from the profile", () => {
    const createdAt = Date.parse("2026-01-01T00:00:00Z");
    const pending = pendingRuntimeFromProfile({ profile: profile(), createdAt });

    expect(pending.id).toBe(pendingRuntimeId("profile-1"));
    // The profile's own name, never a synthesized "<name> (machine)" — there is
    // no machine to name on a phone with no local daemon.
    expect(pending.name).toBe("Team Codex");
    expect(pending.status).toBe("offline");
    expect(pending.daemon_id).toBeNull();
    expect(pending.device_info).toBe("");
    expect(pending.profile_id).toBe("profile-1");
    expect(pending.provider).toBe("codex");
    expect(pending.visibility).toBe("private");
    // Attribution falls back to the profile's creator, like web's list page.
    expect(pending.owner_id).toBe("user-1");
    expect(isPendingCustomRuntime(pending)).toBe(true);
    expect(pendingRuntimeCommandName(pending)).toBe("team-codex");
  });

  it("keeps an explicit owner over the profile creator", () => {
    const pending = pendingRuntimeFromProfile({
      profile: profile(),
      createdAt: 0,
      ownerId: "user-9",
    });
    expect(pending.owner_id).toBe("user-9");
  });

  it("falls back to the epoch when created_at is unparseable", () => {
    const pending = pendingRuntimeFromProfile({
      profile: profile({ created_at: "not-a-date" }),
      createdAt: Date.parse("not-a-date") || 0,
    });
    expect(pending.metadata?.pending_since).toBe(
      new Date(0).toISOString(),
    );
  });

  it("reads the disabled flag off the profile", () => {
    const enabled = pendingRuntimeFromProfile({
      profile: profile({ enabled: true }),
      createdAt: 0,
    });
    const disabled = pendingRuntimeFromProfile({
      profile: profile({ enabled: false }),
      createdAt: 0,
    });

    expect(isDisabledCustomRuntime(enabled)).toBe(false);
    expect(isDisabledCustomRuntime(disabled)).toBe(true);
    // A plain runtime is never "disabled" — the flag only means anything on a
    // placeholder.
    expect(isDisabledCustomRuntime(runtime())).toBe(false);
  });

  it("surfaces a registration failure and its reason", () => {
    const failed = pendingRuntimeFromProfile({ profile: profile(), createdAt: 0 });
    failed.metadata = {
      ...failed.metadata,
      runtime_profile_registration_error: true,
      runtime_profile_failure_reason: "command not found",
    };
    expect(customRuntimeRegistrationFailure(failed)).toBe("command not found");

    const blank = pendingRuntimeFromProfile({ profile: profile(), createdAt: 0 });
    blank.metadata = {
      ...blank.metadata,
      runtime_profile_registration_error: true,
      runtime_profile_failure_reason: "   ",
    };
    expect(customRuntimeRegistrationFailure(blank)).toBeNull();
    expect(customRuntimeRegistrationFailure(runtime())).toBeNull();
  });

  it("only warns once the wait passes the web threshold", () => {
    const pendingSince = Date.parse("2026-01-01T00:00:00Z");
    const pending = pendingRuntimeFromProfile({
      profile: profile(),
      createdAt: pendingSince,
    });

    expect(
      isPendingCustomRuntimeWarning(pending, pendingSince + PENDING_RUNTIME_WARNING_MS - 1),
    ).toBe(false);
    expect(
      isPendingCustomRuntimeWarning(pending, pendingSince + PENDING_RUNTIME_WARNING_MS),
    ).toBe(true);
    expect(isPendingCustomRuntimeWarning(runtime(), Date.now())).toBe(false);
  });
});

describe("orphanProfileRuntimes", () => {
  it("lists every unregistered profile when no local machine is present", () => {
    const rows = orphanProfileRuntimes({
      machines: [machine()],
      profiles: [profile(), profile({ id: "profile-2", display_name: "Team Aider" })],
      runtimes: [runtime()],
    });

    expect(rows.map((r) => r.name)).toEqual(["Team Codex", "Team Aider"]);
  });

  it("skips profiles that a machine is already serving", () => {
    const rows = orphanProfileRuntimes({
      machines: [machine()],
      profiles: [profile(), profile({ id: "profile-2", display_name: "Team Aider" })],
      // profile-1 is registered on a remote machine and already has a row.
      runtimes: [runtime({ profile_id: "profile-1" })],
    });

    expect(rows.map((r) => r.name)).toEqual(["Team Aider"]);
  });

  it("stays empty while a local machine is in the list", () => {
    const rows = orphanProfileRuntimes({
      machines: [machine({ mode: "local", section: "local" })],
      profiles: [profile()],
      runtimes: [runtime({ runtime_mode: "local", daemon_id: "daemon-1" })],
    });

    expect(rows).toEqual([]);
  });

  it("stays empty for a workspace with no runtimes at all", () => {
    // The page renders its empty state there; placeholders on top of "no
    // runtimes yet" would contradict it.
    expect(
      orphanProfileRuntimes({ machines: [], profiles: [profile()], runtimes: [] }),
    ).toEqual([]);
  });

  it("stays empty when the workspace has no custom profiles", () => {
    expect(
      orphanProfileRuntimes({ machines: [], profiles: [], runtimes: [runtime()] }),
    ).toEqual([]);
  });
});
