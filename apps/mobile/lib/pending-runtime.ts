/**
 * Pending custom runtimes — the placeholder rows a workspace's custom runtime
 * profiles get when no machine is currently serving them.
 *
 * Web parity: `packages/views/runtimes/components/pending-runtime.ts` plus the
 * gate in `runtimes-page.tsx` (`orphanProfileRuntimes`, :144-154) that decides
 * when the list page shows them. A custom runtime profile is a workspace-wide
 * definition; the runtime row only exists while some daemon has it enabled and
 * registered. When this device's daemon is down its runtimes can be swept, and
 * the definition silently disappears from the phone — the section exists so the
 * user still sees what they configured and can act on it.
 *
 * Two web behaviours are deliberately NOT copied:
 *
 *   - Web's list page maps *every* profile to a pending row once no local
 *     machine exists, so a profile registered on a remote machine is listed
 *     twice. Web's own `pendingRuntimesForProfiles` filters on the registered
 *     profile ids instead, which is also what the section's own copy promises
 *     ("not connected to any machine") — that filter is used here.
 *   - `pendingRuntimeFromProfile` here never invents a machine name: the phone
 *     has no local daemon identity to fall back on, so the label comes from the
 *     profile's display name alone.
 */
import type { AgentRuntime, RuntimeProfile } from "@multica/core/types";
import type { RuntimeMachine } from "./runtime-machines";

/** After this long unregistered, web stops saying "registering" and starts
 *  asking the user to check the daemon (runtime-list.tsx HealthCell). */
export const PENDING_RUNTIME_WARNING_MS = 45_000;

const PENDING_RUNTIME_ID_PREFIX = "pending-runtime-profile:";

interface PendingRuntimeMetadata extends Record<string, unknown> {
  pending_custom_runtime: true;
  runtime_profile_id: string;
  runtime_profile_enabled: boolean;
  command_name: string;
  pending_since: string;
}

export function pendingRuntimeId(profileId: string): string {
  return `${PENDING_RUNTIME_ID_PREFIX}${profileId}`;
}

export function isPendingCustomRuntime(runtime: AgentRuntime): boolean {
  return runtime.metadata?.pending_custom_runtime === true;
}

export function isDisabledCustomRuntime(runtime: AgentRuntime): boolean {
  return (
    isPendingCustomRuntime(runtime) &&
    runtime.metadata?.runtime_profile_enabled === false
  );
}

/** The profile's command, for the row's secondary line. */
export function pendingRuntimeCommandName(runtime: AgentRuntime): string | null {
  const command = runtime.metadata?.command_name;
  return typeof command === "string" && command.trim() ? command : null;
}

/** Set when the daemon tried and failed to register the profile. */
export function customRuntimeRegistrationFailure(
  runtime: AgentRuntime,
): string | null {
  if (runtime.metadata?.runtime_profile_registration_error !== true) return null;
  const reason = runtime.metadata.runtime_profile_failure_reason;
  return typeof reason === "string" && reason.trim() ? reason : null;
}

/** True once the wait is long enough to be worth flagging. */
export function isPendingCustomRuntimeWarning(
  runtime: AgentRuntime,
  now: number,
): boolean {
  if (!isPendingCustomRuntime(runtime)) return false;
  const pendingSince = runtime.metadata?.pending_since;
  if (typeof pendingSince !== "string") return false;
  const startedAt = new Date(pendingSince).getTime();
  if (!Number.isFinite(startedAt)) return false;
  return now - startedAt >= PENDING_RUNTIME_WARNING_MS;
}

/**
 * One profile → one offline placeholder runtime, in the shape the runtime row
 * already renders (so no row-level special casing beyond the pending badges).
 */
export function pendingRuntimeFromProfile({
  profile,
  createdAt,
  ownerId,
}: {
  profile: RuntimeProfile;
  createdAt: number;
  ownerId?: string | null;
}): AgentRuntime {
  const pendingSince = new Date(createdAt).toISOString();
  const metadata: PendingRuntimeMetadata = {
    pending_custom_runtime: true,
    runtime_profile_id: profile.id,
    runtime_profile_enabled: profile.enabled,
    command_name: profile.command_name,
    pending_since: pendingSince,
  };

  return {
    id: pendingRuntimeId(profile.id),
    workspace_id: profile.workspace_id,
    daemon_id: null,
    name: profile.display_name,
    runtime_mode: "local",
    provider: profile.protocol_family,
    launch_header: profile.protocol_family,
    status: "offline",
    // No daemon has reported this runtime, so there is no device to name —
    // web fills this with its "Unassigned" fallback label, which would read as
    // a machine name here.
    device_info: "",
    metadata,
    owner_id: ownerId ?? profile.created_by ?? null,
    visibility: "private",
    profile_id: profile.id,
    last_seen_at: pendingSince,
    created_at: pendingSince,
    updated_at: pendingSince,
  };
}

/**
 * The "no machine is serving these" section's rows.
 *
 * Empty unless the workspace has runtimes at all and none of them is a local
 * machine — with a local machine present, its own runtimes (pending or not)
 * already answer "what did I configure on this device", and web suppresses the
 * section for the same reason.
 */
export function orphanProfileRuntimes({
  machines,
  profiles,
  runtimes,
}: {
  machines: RuntimeMachine[];
  profiles: RuntimeProfile[];
  runtimes: AgentRuntime[];
}): AgentRuntime[] {
  if (profiles.length === 0) return [];
  if (runtimes.length === 0) return [];
  if (machines.some((machine) => machine.mode === "local")) return [];

  const registeredProfileIds = new Set(
    runtimes
      .map((runtime) => runtime.profile_id)
      .filter((profileId): profileId is string => !!profileId),
  );

  return profiles
    .filter((profile) => !registeredProfileIds.has(profile.id))
    .map((profile) => {
      const createdAt = Date.parse(profile.created_at);
      return pendingRuntimeFromProfile({
        profile,
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
      });
    });
}
