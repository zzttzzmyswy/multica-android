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
import { skillKeys } from "@/data/queries/skills";
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