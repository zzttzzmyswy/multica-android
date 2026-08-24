/**
 * Actor Issues 列表查询 —— web `common/actor-issues-panel.tsx` 的移动端数据层。
 *
 * 复用 `api.listIssues` 的 assignee_filters / creator_filters（`type:id` 序列化，
 * 见 data/api.ts），queryKey 走 issueKeys.actorList —— 位于 `actorAll(wsId)`
 * 前缀下，WS 层可用一个 `invalidateQueries(actorAll(wsId))` 覆盖全部 actor 面板。
 * relation 入 cache key：scope 切换（assigned ↔ created）自动 refetch。
 */
import { queryOptions } from "@tanstack/react-query";
import { api } from "@/data/api";
import {
  buildActorIssuesFilter,
  type ActorIssuesActorType,
  type ActorIssuesRelation,
} from "@/lib/actor-issues";
import { issueKeys } from "./issue-keys";

export { issueKeys } from "./issue-keys";

export const actorIssuesListOptions = (
  wsId: string | null,
  actorType: ActorIssuesActorType,
  actorId: string,
  relation: ActorIssuesRelation,
) =>
  queryOptions({
    queryKey: issueKeys.actorList(wsId, actorType, actorId, relation),
    staleTime: 30_000,
    enabled: !!wsId && !!actorId,
    queryFn: async ({ signal }) => {
      const filter = buildActorIssuesFilter(actorType, actorId, relation);
      const res = await api.listIssues(filter, { signal });
      return res.issues;
    },
  });