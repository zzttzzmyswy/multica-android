/**
 * Runtime local-skill discovery + import (web packages/core/runtimes/
 * local-skills.ts port). POST kicks off a daemon request, then polls GET until
 * the request leaves pending/running — old daemons claim one queued request
 * per heartbeat (~15s), so the budget must cover queue wait plus the work.
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import type {
  CreateRuntimeLocalSkillImportRequest,
  DisabledRuntimeSkill,
  RuntimeLocalSkillImportResult,
  RuntimeLocalSkillSummary,
  RuntimeLocalSkillsResult,
} from "@multica/core/types";

export const runtimeLocalSkillsKeys = {
  all: () => ["runtimes", "local-skills"] as const,
  forRuntime: (runtimeId: string) =>
    [...runtimeLocalSkillsKeys.all(), runtimeId] as const,
};

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30_000;
// Imports get a much longer budget than discovery: old daemons (pre-batch) pop
// only one import per heartbeat cycle (~15s), so with 10 queued imports the
// 10th waits up to 150s in pending before being claimed, plus up to 60s for
// the daemon to actually run it. Timeout invariant: this must exceed
// runtimeLocalSkillPendingTimeout + runtimeLocalSkillRunningTimeout
// (server/internal/handler/runtime_local_skills.go). See also IMPORT_CONCURRENCY
// in web's runtime-local-skill-import-panel.tsx.
const IMPORT_POLL_TIMEOUT_MS = 4 * 60_000;

export async function resolveRuntimeLocalSkills(
  runtimeId: string,
): Promise<RuntimeLocalSkillsResult> {
  const initial = await api.initiateListLocalSkills(runtimeId);
  const start = Date.now();
  let current = initial;

  while (current.status === "pending" || current.status === "running") {
    if (Date.now() - start > POLL_TIMEOUT_MS) {
      throw new Error("runtime local skill discovery timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await api.getListLocalSkillsResult(runtimeId, initial.id);
  }

  if (current.status === "failed" || current.status === "timeout") {
    throw new Error(current.error || "runtime local skill discovery failed");
  }

  return {
    skills: current.skills ?? [],
    supported: current.supported,
    mcpServers: current.mcp_servers ?? [],
    mcpSupported: current.mcp_supported === true,
  };
}

export function runtimeLocalSkillsOptions(runtimeId: string | null | undefined) {
  return queryOptions({
    queryKey: runtimeId
      ? runtimeLocalSkillsKeys.forRuntime(runtimeId)
      : runtimeLocalSkillsKeys.all(),
    queryFn: () => resolveRuntimeLocalSkills(runtimeId as string),
    enabled: Boolean(runtimeId),
    staleTime: 30_000,
    retry: false,
  });
}

export const runtimeCapabilitiesOptions = runtimeLocalSkillsOptions;

/**
 * Import one runtime-local skill into the workspace and wait for the daemon's
 * verdict. `status: "conflict"` is a RESULT, not an error — the caller decides
 * whether to retry with `action: "overwrite"` / `target_skill_id`. `created`
 * vs `updated` comes from the action the server actually applied.
 */
export async function resolveRuntimeLocalSkillImport(
  runtimeId: string,
  payload: CreateRuntimeLocalSkillImportRequest,
): Promise<RuntimeLocalSkillImportResult> {
  const initial = await api.initiateImportLocalSkill(runtimeId, payload);
  const start = Date.now();
  let current = initial;

  while (current.status === "pending" || current.status === "running") {
    if (Date.now() - start > IMPORT_POLL_TIMEOUT_MS) {
      throw new Error("runtime local skill import timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await api.getImportLocalSkillResult(runtimeId, initial.id);
  }

  if (current.status === "conflict") {
    if (!current.conflict) {
      throw new Error("runtime local skill import conflict missing details");
    }
    return { status: "conflict", conflict: current.conflict };
  }

  if (current.status === "failed" || current.status === "timeout") {
    throw new Error(current.error || "runtime local skill import failed");
  }
  if (!current.skill) {
    throw new Error("runtime local skill import did not return a skill");
  }

  return {
    status: current.action === "overwrite" ? "updated" : "created",
    skill: current.skill,
  };
}

export function runtimeSkillIdentity(skill: RuntimeLocalSkillSummary): string {
  return `runtime:${skill.root ?? "unknown"}:${skill.key}:${skill.plugin ?? ""}`;
}

export function isRuntimeSkillDisabled(
  disabledSkills: DisabledRuntimeSkill[] | undefined,
  runtimeId: string | undefined,
  skill: RuntimeLocalSkillSummary,
): boolean {
  if (!runtimeId || !skill.root) return false;
  return (disabledSkills ?? []).some(
    (disabled) =>
      disabled.runtime_id === runtimeId &&
      disabled.provider === skill.provider &&
      disabled.root === skill.root &&
      disabled.key === skill.key &&
      (disabled.plugin ?? "") === (skill.plugin ?? ""),
  );
}
