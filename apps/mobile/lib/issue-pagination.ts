/**
 * Issue-list pagination —— 三个分页列表表面（工作区 issue 列表 / my-issues /
 * 项目 issue 列表）共用的纯函数层。web 对应物是
 * `packages/views/issues/components/list-load-more-footer.tsx`：页大小阈值 50，
 * 页脚四态由 `hasMore` / `isLoading` / `total` / `isError` 决定。
 *
 * 分页参数走服务端 `limit` / `offset`（`GET /api/issues`，limit 被服务端钳到
 * 100，见 server/internal/handler/issue.go），响应带整个窗口的 `total`。因此
 * 「还有下一页」的权威判据是「已取行数 < total」，而不是「本页不满」。
 */
import type { Issue } from "@multica/core/types";

/** 每页行数。取 50 与 web 的 `PAGINATED_THRESHOLD` 对齐：一页装得下的列表
 *  自证完整，不该出现「没有更多」页脚。 */
export const ISSUE_PAGE_SIZE = 50;

/** 超过一页才显示「没有更多」标记的阈值，同 web。 */
export const PAGINATED_THRESHOLD = 50;

/** 单页结果 —— 服务端返回的行 + 整个窗口的总数。 */
export interface IssuePage {
  issues: Issue[];
  total: number;
  /**
   * 这一页**服务端当时返回的行数**。`issues` 会被 WS / 乐观更新就地增删，但
   * offset 索引的是服务端窗口，不是我们本地补丁过的视图 —— 所以下一页的
   * offset 必须按这个不变量累加。若改用 `issues.length`，一条 WS 新建的行会
   * 把 offset 顶掉一格，跳过一条从未拉取的服务端行，而 `total` 却已凑满，
   * 页脚随即显示「没有更多」：正是本迭代要消灭的静默截断。
   */
  fetched: number;
}

export function makeIssuePage(issues: Issue[], total: number): IssuePage {
  return { issues, total, fetched: issues.length };
}

/** 已取到的行按页展开、按 id 去重（先到先得，保持顺序）。分页之间若有 issue
 *  被创建/删除，offset 窗口会滑动导致同一行出现在两页里 —— 去重保证 UI 不会
 *  渲染出重复 key。 */
export function flattenIssuePages(pages: readonly IssuePage[]): Issue[] {
  const seen = new Set<string>();
  const rows: Issue[] = [];
  for (const page of pages) {
    for (const issue of page.issues) {
      if (seen.has(issue.id)) continue;
      seen.add(issue.id);
      rows.push(issue);
    }
  }
  return rows;
}

/** 整个窗口的服务端总数（取最后一页的 `total`）。无页时为 0。 */
export function issueListTotal(pages: readonly IssuePage[]): number {
  const last = pages[pages.length - 1];
  return last ? last.total : 0;
}

/**
 * 下一页的 `offset`，`undefined` 表示已经取完（无限滚动到此为止）。
 *
 * 判定顺序：
 *   - 无页 / 末页服务端返回 0 行 → 结束。空页是「服务端没有更多」的唯一可靠
 *     信号，缺失它会变成永远拉不到东西的死循环。
 *   - `total > 0` → 以服务端总数为准：已取行数 < total 才继续。schema 会把
 *     缺失的 total 兜底成 0，所以 0 不能读作「已经取全」。
 *   - `total` 不可信（0/缺失）→ 退回「末页满则可能还有」的保守判据。
 *
 * 累加的是 `p.fetched`（服务端当时的行数）而不是 `p.issues.length`，见 `IssuePage.fetched`。
 */
export function nextIssuePageParam(
  pages: readonly IssuePage[],
): number | undefined {
  const last = pages[pages.length - 1];
  if (!last || last.fetched === 0) return undefined;
  const fetched = pages.reduce((n, p) => n + p.fetched, 0);
  if (last.total > 0) return fetched < last.total ? fetched : undefined;
  return last.fetched >= ISSUE_PAGE_SIZE ? fetched : undefined;
}

/** 是否仍在加载中——页脚据此渲染 sentinel + 「加载中…」。 */
export function hasMoreIssues(pages: readonly IssuePage[]): boolean {
  return pages.length > 0 && nextIssuePageParam(pages) !== undefined;
}

/** 是否渲染「没有更多了」页脚。只在真的翻过页（总数超过一页）时渲染，短列表
 *  自证完整、不加标记 —— 同 web `ListLoadMoreFooter`。 */
export function showNoMoreIssues(pages: readonly IssuePage[]): boolean {
  if (pages.length === 0) return false;
  if (hasMoreIssues(pages)) return false;
  return issueListTotal(pages) > PAGINATED_THRESHOLD;
}
