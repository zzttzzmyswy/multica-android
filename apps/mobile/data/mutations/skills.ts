/**
 * Mobile-side skill mutations. Mirrors the label pattern (optimistic list
 * patch with the authoritative server response + list invalidate on settle)
 * bound to mobile's own ApiClient. The list cache stores a flat
 * `SkillSummary[]`; a created/updated skill patches it in place so the list
 * reflects the change without waiting for a refetch, and the detail cache
 * is seeded on create so a post-create navigation to the new skill renders
 * immediately.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateSkillRequest,
  Skill,
  SkillSummary,
  UpdateSkillRequest,
} from "@multica/core/types";
import { api } from "@/data/api";
import { agentKeys } from "@/data/queries/agents";
import { skillKeys } from "@/data/queries/skills";
import { summarizeBatch } from "@/lib/skill-batch";
import { useWorkspaceStore } from "@/data/workspace-store";

function useInvalidateSkills(wsId: string | null) {
  const qc = useQueryClient();
  return () => {
    if (!wsId) return;
    void qc.invalidateQueries({ queryKey: skillKeys.all(wsId) });
  };
}

function usePatchSkillList(wsId: string | null) {
  const qc = useQueryClient();
  return (updater: (old: SkillSummary[]) => SkillSummary[]) => {
    qc.setQueryData<SkillSummary[]>(skillKeys.all(wsId), (old) =>
      old ? updater(old) : old,
    );
  };
}

export function useCreateSkill() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateSkills(wsId);
  const patchList = usePatchSkillList(wsId);

  return useMutation({
    mutationFn: (body: CreateSkillRequest) => api.createSkill(body),
    onSuccess: (skill) => {
      if (!skill.id) return;
      patchList((old) =>
        old.some((s) => s.id === skill.id) ? old : [skill, ...old],
      );
      if (wsId) {
        qc.setQueryData<Skill>(skillKeys.detail(wsId, skill.id), skill);
      }
    },
    onSettled: invalidate,
  });
}

export function useUpdateSkill() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateSkills(wsId);
  const patchList = usePatchSkillList(wsId);

  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & UpdateSkillRequest) =>
      api.updateSkill(id, body),
    onSuccess: (skill) => {
      if (!skill.id) return;
      patchList((old) => old.map((s) => (s.id === skill.id ? skill : s)));
    },
    onSettled: invalidate,
  });
}

export function useDeleteSkill() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateSkills(wsId);
  const patchList = usePatchSkillList(wsId);

  return useMutation({
    mutationFn: (id: string) => api.deleteSkill(id),
    onSuccess: (_void, id) => {
      patchList((old) => old.filter((s) => s.id !== id));
    },
    onSettled: invalidate,
  });
}

/**
 * URL import — `POST /api/skills/import`. Same cache handling as
 * `useCreateSkill`: the returned skill is a full Skill, so adopt it into both
 * the list and the detail cache.
 */
export function useImportSkill() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateSkills(wsId);
  const patchList = usePatchSkillList(wsId);

  return useMutation({
    mutationFn: (url: string) => api.importSkill({ url }),
    onSuccess: (skill) => {
      if (!skill.id) return;
      patchList((old) =>
        old.some((s) => s.id === skill.id) ? old : [skill, ...old],
      );
      if (wsId) {
        qc.setQueryData<Skill>(skillKeys.detail(wsId, skill.id), skill);
      }
    },
    onSettled: invalidate,
  });
}

/**
 * Remote refresh — `POST /api/skills/:id/refresh`. Adopts the refreshed skill
 * into the detail cache when the server echoes a valid skill (same id), so the
 * open detail page updates without a refetch; a malformed fallback instead
 * just drops the stale detail + list caches. Mirrors web
 * refresh-skill-dialog.tsx's cache handling.
 */
export function useRefreshSkill() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();
  const invalidate = useInvalidateSkills(wsId);

  return useMutation({
    mutationFn: (id: string) => api.refreshSkill(id),
    onSuccess: (skill, id) => {
      if (wsId && skill.id === id) {
        qc.setQueryData<Skill>(skillKeys.detail(wsId, id), skill);
      } else if (wsId) {
        // Schema-degraded response (empty fallback): drop the stale detail
        // cache instead of seeding it with the placeholder.
        qc.invalidateQueries({ queryKey: skillKeys.detail(wsId, id) });
      }
    },
    onSettled: invalidate,
  });
}

/**
 * Batch delete — the server has no batch route, so this fans the single-skill
 * DELETE out concurrently and reports the settled outcome. Rows that landed
 * are dropped from the list cache immediately; the surviving rows keep their
 * place instead of waiting on the settle-time invalidate (a partial failure
 * must not look like the whole batch was rejected).
 *
 * Web's `DeleteSkillsDialog.handleConfirm` runs the same calls serially and
 * aborts on the first error. Concurrency plus `allSettled` is the deliberate
 * difference: on a phone, N sequential round-trips is the slower half of the
 * interaction and the user still needs to know exactly which rows survived.
 */
export function useBatchDeleteSkills() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const invalidate = useInvalidateSkills(wsId);
  const patchList = usePatchSkillList(wsId);

  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => api.deleteSkill(id)),
      );
      return summarizeBatch(ids, results);
    },
    onSuccess: (outcome) => {
      if (outcome.succeeded.length === 0) return;
      const done = new Set(outcome.succeeded);
      patchList((old) => old.filter((s) => !done.has(s.id)));
    },
    onSettled: invalidate,
  });
}

/**
 * Batch attach — `POST /api/agents/:id/skills/add` per target (additive and
 * idempotent server-side). The plan is computed by the caller from the loaded
 * agent list (`planSkillAttach`), so a target that already holds every
 * selected skill never produces a request. Same all-settled accounting as the
 * delete above; the agent list is invalidated on settle because a successful
 * attach changes each agent's `skills` array.
 */
export function useBatchAddSkillsToAgents() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (
      plan: readonly { agentId: string; skillIds: string[] }[],
    ) => {
      const results = await Promise.allSettled(
        plan.map((target) =>
          api.addAgentSkills(target.agentId, { skill_ids: target.skillIds }),
        ),
      );
      return summarizeBatch(
        plan.map((target) => target.agentId),
        results,
      );
    },
    onSuccess: (outcome) => {
      // Only the targets that actually changed need a refetch; on a partial
      // failure the rejects keep their cached (unchanged) bindings.
      if (outcome.succeeded.length === 0) return;
      qc.invalidateQueries({ queryKey: agentKeys.list(wsId) });
      qc.invalidateQueries({ queryKey: agentKeys.listAll(wsId) });
    },
  });
}