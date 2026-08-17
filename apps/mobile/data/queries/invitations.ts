import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";

/** My pending invitations — the global invite feed backing the workspace
 *  selector's "pending invitations" section (mirror of core
 *  workspaceKeys.myInvitations() on the web sidebar). */
export const myInvitationsOptions = () =>
  queryOptions({
    queryKey: ["invitations"] as const,
    queryFn: ({ signal }) => api.listMyInvitations({ signal }),
  });