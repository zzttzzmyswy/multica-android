/**
 * Pure download-task model + reducer for the in-app download manager.
 *
 * User-visible requirement (MYS-336): attachment downloads from chat / issue
 * surfaces must be trackable — progress while running, history afterwards,
 * cancel / retry / delete. All of that state is a JSON document of
 * `DownloadTask`s; keeping the transitions here as pure functions (no
 * expo / zustand / RN imports) lets the Node vitest lane cover the state
 * machine invariants without loading any native module.
 *
 * The reactive store (`data/downloads-store.ts`) owns the task list and
 * persistence; this module owns *shape and transitions* only.
 */

export type DownloadStatus = "downloading" | "completed" | "failed" | "cancelled";

/** Where a download originated — rendered as the list's source column. */
export type DownloadSourceKind = "chat" | "issue" | "other";

export interface DownloadSource {
  kind: DownloadSourceKind;
  /** Optional human-readable context: chat-session title / issue title. */
  name?: string;
}

export interface DownloadTask {
  id: string;
  /** Safe basename the file was written under in the app cache. */
  filename: string;
  /** Absolute download URL (already rebased onto the configured API base). */
  url: string;
  /** MIME hint for the system open/share sheet. */
  mimeType?: string;
  source: DownloadSource;
  status: DownloadStatus;
  /** 0..1 fraction downloaded; pinned to 1 on completion. */
  progress: number;
  /** Total bytes when the server sent Content-Length, else null. */
  totalBytes: number | null;
  error?: string | null;
  /** Epoch ms when the task was registered. */
  createdAt: number;
  completedAt?: number | null;
  /** `file://` URI of the finished download (terminal + completed). */
  localUri?: string | null;
}

/** History cap for the tasks list (spec MYS-336 §「历史裁剪上限」). */
export const HISTORY_LIMIT = 50;

export function isTerminalStatus(status: DownloadStatus): boolean {
  return status !== "downloading";
}

export function activeDownloadCount(tasks: DownloadTask[]): number {
  return tasks.reduce((n, t) => n + (t.status === "downloading" ? 1 : 0), 0);
}

/**
 * Fraction written when the server reports Content-Length; otherwise keep the
 * caller's `fallback` (e.g. the previous progress). `-1` is what the file
 * system reports when the size is unknown. Clamped to 0..1.
 */
export function normalizeProgress(
  written: number,
  expected: number,
  fallback = 0,
): number {
  if (!Number.isFinite(written) || written <= 0) return 0;
  if (!Number.isFinite(expected) || expected <= 0) return fallback;
  return Math.min(1, Math.max(0, written / expected));
}

export type DownloadAction =
  | {
      type: "begin";
      id: string;
      filename: string;
      url: string;
      mimeType?: string;
      source: DownloadSource;
      createdAt: number;
    }
  | { type: "progress"; id: string; written: number; expected: number }
  | { type: "complete"; id: string; localUri: string; at: number }
  | { type: "fail"; id: string; error: string; at: number }
  | { type: "cancel"; id: string; at: number }
  | { type: "remove"; id: string };

/**
 * State machine over `DownloadTask[]` (newest first). Invariants:
 *   - only `downloading` tasks accept progress / complete / fail / cancel;
 *   - unknown ids are no-ops; `begin` replaces a same-id task;
 *   - terminal progress is pinned to 1 (complete) or left as-is (others).
 */
export function downloadReducer(
  tasks: DownloadTask[],
  action: DownloadAction,
): DownloadTask[] {
  switch (action.type) {
    case "begin": {
      const task: DownloadTask = {
        id: action.id,
        filename: action.filename,
        url: action.url,
        mimeType: action.mimeType,
        source: action.source,
        status: "downloading",
        progress: 0,
        totalBytes: null,
        error: null,
        createdAt: action.createdAt,
        completedAt: null,
        localUri: null,
      };
      return [
        task,
        ...tasks.filter((t) => t.id !== action.id),
      ];
    }
    case "progress": {
      return tasks.map((t) =>
        t.id !== action.id || t.status !== "downloading"
          ? t
          : {
              ...t,
              progress: normalizeProgress(action.written, action.expected, t.progress),
              totalBytes:
                action.expected > 0 ? action.expected : t.totalBytes,
            },
      );
    }
    case "complete": {
      return tasks.map((t) =>
        t.id !== action.id || t.status !== "downloading"
          ? t
          : {
              ...t,
              status: "completed",
              progress: 1,
              localUri: action.localUri,
              completedAt: action.at,
            },
      );
    }
    case "fail": {
      return tasks.map((t) =>
        t.id !== action.id || t.status !== "downloading"
          ? t
          : {
              ...t,
              status: "failed",
              error: action.error,
              completedAt: action.at,
            },
      );
    }
    case "cancel": {
      return tasks.map((t) =>
        t.id !== action.id || t.status !== "downloading"
          ? t
          : { ...t, status: "cancelled", completedAt: action.at },
      );
    }
    case "remove":
      return tasks.filter((t) => t.id !== action.id);
  }
}

/**
 * Trim the list to at most `max` rows — keeping every in-flight task (they
 * are not "history") and the newest `max - active` terminal rows. The task
 * callback trims on every mutation, so memory stays bounded on a device
 * that downloads a lot.
 */
export function trimHistory(
  tasks: DownloadTask[],
  max = HISTORY_LIMIT,
): DownloadTask[] {
  const active: DownloadTask[] = [];
  const terminal: DownloadTask[] = [];
  for (const t of tasks) {
    (t.status === "downloading" ? active : terminal).push(t);
  }
  const keep = Math.max(0, max - active.length);
  return [...active, ...terminal.slice(0, keep)];
}

/** i18n key for the source-kind label (localization lives in the views). */
export function downloadSourceLabelKey(source: DownloadSource): string {
  switch (source.kind) {
    case "chat":
      return "downloads.source.chat";
    case "issue":
      return "downloads.source.issue";
    default:
      return "downloads.source.other";
  }
}

/** The optional context name a source carries (session / issue title). */
export function downloadSourceName(source: DownloadSource): string | undefined {
  return source.name || undefined;
}

/**
 * Readable, locale-independent source label — used as a test oracle and a
 * fallback; the UI renders `t(downloadSourceLabelKey(source))` instead.
 */
export function formatDownloadSource(source: DownloadSource): string {
  const kind = source.kind.charAt(0).toUpperCase() + source.kind.slice(1);
  return source.name ? `${kind} · ${source.name}` : kind;
}