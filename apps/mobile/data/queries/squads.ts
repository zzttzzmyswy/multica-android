import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const squadListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["squads", wsId] as const,
    queryFn: ({ signal }) => api.listSquads({ signal }),
    enabled: !!wsId,
  });

export const squadDetailOptions = (wsId: string | null, squadId: string) =>
  queryOptions({
    queryKey: ["squads", wsId, "detail", squadId] as const,
    queryFn: () => api.getSquad(squadId),
    enabled: !!wsId && !!squadId,
  });

export const squadMemberListOptions = (
  wsId: string | null,
  squadId: string,
) =>
  queryOptions({
    queryKey: ["squads", wsId, "members", squadId] as const,
    queryFn: () => api.listSquadMembers(squadId),
    enabled: !!wsId && !!squadId,
  });

export const squadMemberStatusOptions = (
  wsId: string | null,
  squadId: string,
) =>
  queryOptions({
    queryKey: ["squads", wsId, "member-status", squadId] as const,
    queryFn: () => api.getSquadMemberStatus(squadId),
    enabled: !!wsId && !!squadId,
  });