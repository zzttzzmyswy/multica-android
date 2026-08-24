/**
 * Actor Issues 面板纯函数 —— 移植 web `common/actor-issues-panel.tsx` 语义：
 * 以 member/agent 视角构造 listIssues 过滤参数、客户端搜索过滤、排序。
 * 对齐 web surface 的 actor scope 映射：relation=assigned → assignee_filters、
 * relation=created → creator_filters（序列化 `type:id`，data/api.ts 已支持）。
 */
import type { Issue } from "@multica/core/types";

/** web `ActorIssuesPanel` 的 actor 维度 —— member（成员详情页）或
 *  agent（agent 详情页 Work tab）。 */
export type ActorIssuesActorType = "member" | "agent";

/** web `ActorIssuesScope` —— assigned：该 actor 负责；created：该 actor 创建。 */
export type ActorIssuesRelation = "assigned" | "created";

export interface ActorIssuesFilterParam {
  type: ActorIssuesActorType;
  id: string;
}

/** listIssues 的 window params 子集（assignee_filters / creator_filters）。 */
export interface ActorIssuesFilter {
  assignee_filters?: ActorIssuesFilterParam[];
  creator_filters?: ActorIssuesFilterParam[];
}

/** 构造 listIssues 的 actor 过滤参数。web 语义（use-issue-surface-controller
 *  actor case）：assigned → kind=assignee（assignee_filters）、
 *  created → kind=creator（creator_filters）。 */
export function buildActorIssuesFilter(
  actorType: ActorIssuesActorType,
  actorId: string,
  relation: ActorIssuesRelation,
): ActorIssuesFilter {
  return relation === "assigned"
    ? { assignee_filters: [{ type: actorType, id: actorId }] }
    : { creator_filters: [{ type: actorType, id: actorId }] };
}

/** 客户端搜索过滤 —— 忽略大小写匹配 identifier 或 title（对齐 web actor
 *  面板搜索输入，search.trim() 为空返回全部）。 */
export function filterActorIssues(issues: Issue[], search: string): Issue[] {
  const q = search.trim().toLowerCase();
  if (q === "") return issues;
  return issues.filter(
    (i) =>
      i.identifier.toLowerCase().includes(q) ||
      (i.title ?? "").toLowerCase().includes(q),
  );
}

/** 稳定排序 —— created_at 倒序（web actor 面板默认列表顺序的移动端语义；
 *  相同 created_at 保持输入顺序）。返回新数组，不改入参。 */
export function sortActorIssues(issues: Issue[]): Issue[] {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => {
      const byDate =
        b.issue.created_at.localeCompare(a.issue.created_at);
      return byDate !== 0 ? byDate : a.index - b.index;
    })
    .map(({ issue }) => issue);
}