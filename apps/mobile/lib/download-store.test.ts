import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  activeDownloadCount,
  downloadReducer,
  downloadSourceLabelKey,
  downloadSourceName,
  formatDownloadSource,
  normalizeProgress,
  isTerminalStatus,
  trimHistory,
  type DownloadAction,
  type DownloadTask,
  type DownloadSource,
} from "./download-store";

const base = {
  id: "dl-1",
  filename: "report.pdf",
  url: "https://mu.zztweb.top/api/attachments/a/download",
  source: { kind: "issue", name: "修复登录" } as DownloadSource,
  createdAt: 1_000,
};

function begin(over: Partial<DownloadTask> = {}) {
  return {
    type: "begin",
    id: over.id ?? "dl-1",
    filename: over.filename ?? "report.pdf",
    url: over.url ?? base.url,
    mimeType: over.mimeType,
    source: over.source ?? { kind: "issue", name: "修复登录" },
    createdAt: over.createdAt ?? 1_000,
  } as const;
}

describe("normalizeProgress", () => {
  it("clamps the written/expected ratio into 0..1", () => {
    expect(normalizeProgress(5, 10)).toBe(0.5);
    expect(normalizeProgress(10, 5)).toBe(1);
    expect(normalizeProgress(0, 10)).toBe(0);
  });

  it("keeps the fallback when the expected size is unknown", () => {
    expect(normalizeProgress(1_000, -1, 0.3)).toBe(0.3);
    expect(normalizeProgress(1_000, 0, 0)).toBe(0);
    expect(normalizeProgress(0, 0)).toBe(0);
  });
});

describe("downloadReducer", () => {
  function reduce(actions: DownloadAction[]) {
    return actions.reduce(downloadReducer, [] as DownloadTask[]);
  }

  it("begin prepends a downloading task with default progress", () => {
    const tasks = reduce([begin()]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "dl-1",
      filename: "report.pdf",
      status: "downloading",
      progress: 0,
      totalBytes: null,
      error: null,
      completedAt: null,
      localUri: null,
    });
  });

  it("begin replaces an existing task with the same id", () => {
    const tasks = reduce([begin(), { type: "complete", id: "dl-1", localUri: "file:///a", at: 2_000 }]);
    expect(tasks[0].status).toBe("completed");
    const again = downloadReducer(tasks, begin({ createdAt: 3_000 }));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ createdAt: 3_000, status: "downloading" });
  });

  it("progress updates ratio and records totalBytes", () => {
    const tasks = reduce([begin(), { type: "progress", id: "dl-1", written: 25, expected: 100 }]);
    expect(tasks[0].progress).toBe(0.25);
    expect(tasks[0].totalBytes).toBe(100);
  });

  it("progress with unknown content-length keeps the previous progress", () => {
    const tasks = reduce([
      begin(),
      { type: "progress", id: "dl-1", written: 25, expected: 100 },
      { type: "progress", id: "dl-1", written: 40, expected: -1 },
    ]);
    expect(tasks[0].progress).toBe(0.25);
    // The known Content-Length from the first event is retained.
    expect(tasks[0].totalBytes).toBe(100);
  });

  it("complete transitions to completed with 1.0 progress", () => {
    const tasks = reduce([
      begin(),
      { type: "progress", id: "dl-1", written: 50, expected: 100 },
      { type: "complete", id: "dl-1", localUri: "file:///cache/report.pdf", at: 2_000 },
    ]);
    expect(tasks[0]).toMatchObject({
      status: "completed",
      progress: 1,
      localUri: "file:///cache/report.pdf",
      completedAt: 2_000,
    });
  });

  it("fail records the error and completes at the failure time", () => {
    const tasks = reduce([begin(), { type: "fail", id: "dl-1", error: "network", at: 2_000 }]);
    expect(tasks[0]).toMatchObject({ status: "failed", error: "network", completedAt: 2_000 });
  });

  it("cancel transitions to cancelled", () => {
    const tasks = reduce([begin(), { type: "cancel", id: "dl-1", at: 2_000 }]);
    expect(tasks[0]).toMatchObject({ status: "cancelled", completedAt: 2_000 });
  });

  it("terminal tasks ignore later progress/complete/cancel events", () => {
    const afterContinue = reduce([
      begin(),
      { type: "cancel", id: "dl-1", at: 2_000 },
      { type: "progress", id: "dl-1", written: 50, expected: 100 },
      { type: "complete", id: "dl-1", localUri: "file:///x", at: 3_000 },
    ]);
    expect(afterContinue[0].status).toBe("cancelled");
    expect(afterContinue[0].localUri).toBeNull();
  });

  it("unknown-task actions and remove are handled safely", () => {
    expect(downloadReducer([], { type: "progress", id: "nope", written: 1, expected: 1 })).toEqual([]);
    const tasks = reduce([begin(), { type: "remove", id: "dl-1" }]);
    expect(tasks).toEqual([]);
    expect(
      downloadReducer(reduce([begin()]), { type: "remove", id: "missing" }),
    ).toHaveLength(1);
  });
});

describe("trimHistory", () => {
  function tasksWithStatuses(...statuses: DownloadTask["status"][]): DownloadTask[] {
    return statuses.map((status, i) => ({
      ...base,
      id: `dl-${i}`,
      filename: `f${i}.pdf`,
      progress: 0,
      totalBytes: null,
      status,
    }));
  }

  it("never drops downloading tasks", () => {
    const tasks = tasksWithStatuses("completed", "downloading", "completed");
    const trimmed = trimHistory(tasks, 2);
    expect(trimmed.map((t) => t.status)).toEqual(["downloading", "completed"]);
  });

  it("caps the terminal tail at max minus the active count", () => {
    const tasks = tasksWithStatuses("downloading", "completed", "failed", "cancelled", "completed");
    const trimmed = trimHistory(tasks, 3);
    expect(trimmed).toHaveLength(3);
    expect(trimmed[0].status).toBe("downloading");
    expect(trimmed.slice(1).every((t) => t.status !== "downloading")).toBe(true);
  });

  it("defaults to HISTORY_LIMIT and keeps the newest terminal rows", () => {
    const tasks = tasksWithStatuses(
      ...Array.from({ length: HISTORY_LIMIT + 5 }, () => "completed" as const),
    );
    const trimmed = trimHistory(tasks);
    expect(trimmed).toHaveLength(HISTORY_LIMIT);
  });

  it("keeps only active tasks when there are more active than the cap", () => {
    const tasks = tasksWithStatuses("downloading", "downloading", "downloading");
    expect(trimHistory(tasks, 2).map((t) => t.status)).toEqual([
      "downloading",
      "downloading",
      "downloading",
    ]);
  });
});

describe("source helpers", () => {
  it("maps kinds to i18n label keys", () => {
    expect(downloadSourceLabelKey({ kind: "chat" })).toBe("downloads.source.chat");
    expect(downloadSourceLabelKey({ kind: "issue" })).toBe("downloads.source.issue");
    expect(downloadSourceLabelKey({ kind: "other" })).toBe("downloads.source.other");
  });

  it("exposes the optional context name", () => {
    expect(downloadSourceName({ kind: "issue", name: "修复登录" })).toBe("修复登录");
    expect(downloadSourceName({ kind: "chat" })).toBeUndefined();
  });

  it("formats a readable non-localized label", () => {
    expect(formatDownloadSource({ kind: "issue", name: "修复登录" })).toBe("Issue · 修复登录");
    expect(formatDownloadSource({ kind: "chat" })).toBe("Chat");
    expect(formatDownloadSource({ kind: "other", name: "data.json" })).toBe("Other · data.json");
  });
});

describe("misc helpers", () => {
  it("counts active downloads", () => {
    const tasks: DownloadTask[] = [
      { ...base, id: "a", progress: 0.5, totalBytes: 100, status: "downloading" },
      { ...base, id: "b", progress: 1, totalBytes: 100, status: "completed" },
      { ...base, id: "c", progress: 0.3, totalBytes: 100, status: "failed" },
    ];
    expect(activeDownloadCount(tasks)).toBe(1);
  });

  it("classifies terminal statuses", () => {
    expect(isTerminalStatus("downloading")).toBe(false);
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
  });
});