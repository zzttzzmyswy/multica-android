/**
 * 分页改造后 issue 列表缓存出现两种形状，这个模块是二者之间唯一的适配层：
 *
 *   - `InfiniteData<IssuePage>` —— 三个分页表面（工作区 issue 列表 / my-issues /
 *     项目 issue 列表）。见 data/queries/issues.ts、my-issues.ts、projects.ts。
 *   - `Issue[]` —— 其余仍是单次全量拉取的列表：actor 面板（actor-issues.ts）、
 *     甘特画布（ganttIssuesOptions）、mention 建议条。
 *
 * WS updater 与乐观更新只关心「行」，不该关心分页信封，所以它们一律经
 * `mapIssueRows` 改写、经 `readIssueRows` 读取，两种形状都能命中。少了这层，
 * `old.filter(...)` 会作用在 `{pages, pageParams}` 上并抛 TypeError。
 */
import type { InfiniteData } from "@tanstack/react-query";
import type { Issue } from "@multica/core/types";
import {
  flattenIssuePages,
  type IssuePage,
} from "@/lib/issue-pagination";

/** 分页 issue 列表的缓存载荷。`pageParam` 泛型放宽到 `unknown`：适配层只碰
 *  `pages`，而 `infiniteQueryOptions` 在各调用点推断出的 pageParam 类型并
 *  不完全一致。 */
export type IssueListData = InfiniteData<IssuePage, unknown>;

/** 任一种 issue 列表缓存形状。 */
export type IssueListCache = Issue[] | IssueListData;

function isPaginated(data: IssueListCache): data is IssueListData {
  return !Array.isArray(data);
}

/** 对缓存里的行做一次改写，保持原有形状（分页数据逐页改写）。 */
export function mapIssueRows(
  old: IssueListCache | undefined,
  fn: (rows: Issue[]) => Issue[],
): IssueListCache | undefined {
  if (old === undefined) return undefined;
  if (!isPaginated(old)) return fn(old);
  return {
    ...old,
    pages: old.pages.map((page) => ({ ...page, issues: fn(page.issues) })),
  };
}

/** 读出缓存里的行（分页列表跨页展开去重），无缓存时返回空数组。 */
export function readIssueRows(old: IssueListCache | undefined): Issue[] {
  if (old === undefined) return [];
  if (!isPaginated(old)) return old;
  return flattenIssuePages(old.pages);
}

/**
 * 把一条 issue 写进列表缓存 —— 缓存里已有同 id 的行就**就地替换**，没有才插入
 * （`position` 决定插到首行还是末行）。
 *
 * 不能用 `mapIssueRows` 做插入：它逐页调用回调，而「缓存里没有这条」对每一页
 * 都成立，于是同一条会被塞进每一页。视觉上去重掩盖了它，但每页都多出一行，
 * 白白占内存，也会让任何按行数推断的东西失真。插入只该落在第一页，且必须先
 * 跨页查重。
 */
export function upsertIssueRow(
  old: IssueListCache | undefined,
  issue: Issue,
  position: "prepend" | "append",
): IssueListCache | undefined {
  if (old === undefined) return undefined;

  if (!isPaginated(old)) {
    const at = old.findIndex((i) => i.id === issue.id);
    if (at === -1) {
      return position === "prepend" ? [issue, ...old] : [...old, issue];
    }
    const next = old.slice();
    next[at] = issue;
    return next;
  }

  let replaced = false;
  const pages = old.pages.map((page) => {
    const at = page.issues.findIndex((i) => i.id === issue.id);
    if (at === -1) return page;
    replaced = true;
    const issues = page.issues.slice();
    issues[at] = issue;
    return { ...page, issues };
  });
  if (replaced || pages.length === 0) return { ...old, pages };

  const first = pages[0];
  const issues =
    position === "prepend"
      ? [issue, ...first.issues]
      : [...first.issues, issue];
  return { ...old, pages: [{ ...first, issues }, ...pages.slice(1)] };
}
