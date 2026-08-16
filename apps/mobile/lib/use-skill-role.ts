/**
 * Current user's workspace role — the piece of `canEditSkill` that needs the
 * member list. Extracted so the skills list + detail pages share one
 * subscription instead of each re-deriving it.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { MemberRole } from "@multica/core/types";
import { useAuthStore } from "@/data/auth-store";
import { memberListOptions } from "@/data/queries/members";

export function useSkillRole(wsId: string | null): MemberRole | null {
  const userId = useAuthStore((s) => s.user?.id);
  const { data: members } = useQuery(memberListOptions(wsId));
  return useMemo(
    () => members?.find((m) => m.user_id === userId)?.role ?? null,
    [members, userId],
  );
}