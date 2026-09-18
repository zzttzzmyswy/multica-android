/**
 * 聚合视图（看板 / 泳道 / 表格）的分页排空 —— 这三个视图由客户端分组渲染，
 * 只有拿到「整个窗口」才有意义：一个只装了前 50 条的看板会漏掉其它状态列里真实
 * 存在的 issue，是比 web 更差的静默截断（web 的看板是逐列做服务端分页，移动端
 * 只有一个工作区窗口 + 客户端分组，没有逐列分页可做）。
 *
 * 所以线性列表视图用触底加载（真正的无限滚动），聚合视图则在前台把剩余页按序
 * 拉完。`maxRows` 是硬顶，避免在超大型工作区里无限翻页 —— 与甘特画布
 * `fetchGanttIssues` 的 `GANTT_MAX_ISSUES` 同一套纪律。
 *
 * 失败即停：一次翻页失败不重试（否则会变成请求风暴），已加载的部分保留在屏幕上。
 */
import { useEffect } from "react";

/** 聚合视图一次最多排空的窗口行数，同甘特画布的 10k 上限。 */
export const DRAIN_MAX_ROWS = 10_000;

export function shouldDrainNextPage({
  enabled,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  loadedRows,
  maxRows = DRAIN_MAX_ROWS,
}: {
  enabled: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  loadedRows: number;
  maxRows?: number;
}): boolean {
  if (!enabled || !hasNextPage) return false;
  if (isFetchingNextPage || isFetchNextPageError) return false;
  return loadedRows < maxRows;
}

export function useDrainIssuePages(opts: {
  enabled: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  loadedRows: number;
  fetchNextPage: () => void;
  maxRows?: number;
}): void {
  const { fetchNextPage } = opts;
  const drain = shouldDrainNextPage(opts);

  useEffect(() => {
    if (!drain) return;
    fetchNextPage();
  }, [drain, fetchNextPage]);
}
