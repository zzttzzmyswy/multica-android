import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

export const memberListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["members", wsId] as const,
    queryFn: ({ signal }) => api.listMembers(wsId!, { signal }),
    enabled: !!wsId,
  });

/** Workspace's pending invitations (owners/admins see them on the members
 *  page; the server only returns rows the caller may view). */
export const invitationListOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: ["invitations", wsId] as const,
    queryFn: ({ signal }) => api.listWorkspaceInvitations(wsId!, { signal }),
    enabled: !!wsId,
  });
