/**
 * Reactive download-manager store.
 *
 * Single source of truth for the in-app download history (MYS-336). Keeps a
 * `DownloadTask[]` list (newest first) in zustand, persists it to a JSON file
 * in the app document directory (survives restarts — the agent app has no
 * AsyncStorage dependency, and `expo-file-system`'s File API is already in
 * the tree), and orchestrates the actual authenticated downloads through
 * `api.createDownloadTask` (progress → complete → system share sheet).
 *
 * Device-global, not workspace-scoped: a download started from a chat in one
 * workspace stays visible after switching workspaces. Rows don't reference
 * any workspace.
 *
 * Persisted rows that were mid-flight when the app was killed are marked
 * `failed` with the stable error code `interrupted` on hydrate — the native
 * resumable can't survive a process restart without resume data.
 */
import { create } from "zustand";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { api, DownloadCancelledError, type LocalDownload } from "@/data/api";
import { mimeTypeForFilename, sanitizeBasename } from "@/lib/attachment-download";
import { installDownloadedUpdate } from "@/lib/install-update";
import { createRequestId } from "@/lib/request-id";
import {
  activeDownloadCount,
  downloadCacheDirectoryName,
  downloadReducer,
  isTerminalStatus,
  trimHistory,
  type DownloadAction,
  type DownloadSource,
  type DownloadTask,
} from "@/lib/download-store";

const STORAGE_FILE = "download-store.json";

/** Max `totalBytesWritten`/`totalBytesExpectedToWrite` reported by the
 *  native resumable. Mirrors `DownloadProgressData` from
 *  `expo-file-system/legacy`. */
export interface DownloadProgressData {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
}

/** Stable, i18n-able error code written into `DownloadTask.error` when we
 *  control the failure; raw ApiError messages are stored as-is otherwise. */
export const DOWNLOAD_ERROR_INTERRUPTED = "interrupted";

/** Registry of native abort handles, keyed by task id. */
const cancelHandles = new Map<string, () => void>();

/** Shared promises and transfer policies for in-flight tasks. */
const inFlightDownloads = new Map<string, {
  options: ManagedDownloadOptions;
  done: Promise<DownloadOutcome>;
}>();

/** Terminal result of a managed download (MYS-361): the row is already in
 *  the task list before this resolves; `localUri` is set on completion. */
export interface DownloadOutcome {
  status: "completed" | "cancelled" | "failed";
  localUri?: string | null;
  error?: string | null;
}

/** Serialize file writes so a burst of progress events can't interleave. */
let persistChain: Promise<void> = Promise.resolve();

function storageFile(): File {
  return new File(Paths.document, STORAGE_FILE);
}

async function readPersistedTasks(): Promise<DownloadTask[]> {
  try {
    const file = storageFile();
    if (!file.exists) return [];
    const raw = JSON.parse(await file.text()) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(isDownloadTask).map(markInterruptedDown);
  } catch {
    // Corrupt / unreadable history is not worth crashing over — start fresh.
    return [];
  }
}

function isDownloadTask(value: unknown): value is DownloadTask {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.filename === "string" &&
    typeof v.url === "string" &&
    (v.status === "downloading" ||
      v.status === "completed" ||
      v.status === "failed" ||
      v.status === "cancelled")
  );
}

/** A `downloading` row that survived a restart has no native task behind
 *  it — downgrade it to `failed` so the UI can offer retry, never a dead
 *  spinner. */
function markInterruptedDown(task: DownloadTask): DownloadTask {
  if (task.status !== "downloading") return task;
  return {
    ...task,
    status: "failed",
    error: DOWNLOAD_ERROR_INTERRUPTED,
    completedAt: task.completedAt ?? Date.now(),
  };
}

function writePersistedTasks(tasks: DownloadTask[]): void {
  persistChain = persistChain
    .then(async () => {
      storageFile().write(JSON.stringify(tasks));
    })
    .catch(() => {
      // Persistence is best-effort; a failed write must not break downloads.
    });
}

async function deleteLocalFile(
  localUri: string | null | undefined,
  id: string,
  filename?: string,
) {
  if (!localUri) return;
  try {
    // Only remove the per-task cache directory when the file matches exactly.
    if (filename && /^[a-z0-9]+$/.test(id)) {
      const directory = new Directory(Paths.cache, downloadCacheDirectoryName(id));
      if (localUri === new File(directory, filename).uri) {
        if (directory.exists) directory.delete();
        return;
      }
    }
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {
    // Best-effort cleanup; the row is removed regardless.
  }
}

interface ManagedDownloadOptions {
  url: string;
  filename: string;
  mimeType?: string;
  source?: DownloadSource;
  /** Public CDN URLs need no internal auth headers (default true). */
  authenticated?: boolean;
  onCompleted?: (local: LocalDownload) => Promise<void> | void;
}

interface ManagedDownload {
  id: string;
  done: Promise<DownloadOutcome>;
}

interface DownloadsState {
  tasks: DownloadTask[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  /** Enqueue + run an authenticated download. On completion opens the system
   *  share sheet. Dedups downloads with the same transfer and handoff policy. */
  downloadAndOpen: (
    url: string,
    filename: string,
    mimeType?: string,
    source?: DownloadSource,
  ) => Promise<{ id: string }>;
  /**
   * Enqueue + run a download with caller-controlled terminal behavior.
   * The row is tracked like any file download, but `onCompleted` replaces
   * the system share sheet (e.g. APK install). `done` resolves with the
   * terminal outcome and rejects only when `onCompleted` throws.
   */
  downloadManaged: (opts: ManagedDownloadOptions) => Promise<ManagedDownload>;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => Promise<ManagedDownload | undefined>;
  removeTask: (id: string) => Promise<void>;
  clearFinished: () => Promise<void>;
}

/** Apply a list mutation (trim + persist), keeping hydration-safe ordering. */
function applyTasks(get: () => DownloadsState, set: (v: Partial<DownloadsState>) => void, tasks: DownloadTask[]) {
  const next = trimHistory(tasks);
  set({ tasks: next });
  if (get().hydrated) writePersistedTasks(next);
}

export const useDownloadsStore = create<DownloadsState>((set, get) => {
  let hydration: Promise<void> | undefined;

  async function ensureHydrated(): Promise<void> {
    if (!get().hydrated) await get().hydrate();
  }

  /**
   * Drive the native download and fold its lifecycle into the task list:
   *   - complete → `completed` row, then the default share sheet or the
   *     caller's `onCompleted` (whose throws propagate to `done` — the row
   *     is already terminal by then);
   *   - cancelled → `cancelled` row (the UI already marked it or the
   *     native task aborted);
   *   - other errors → `failed` row with the API message.
   * Settles the shared managed promise with the outcome.
   */
  async function runDownload(id: string, opts: ManagedDownloadOptions): Promise<DownloadOutcome> {
    const apply = (action: DownloadAction) =>
      applyTasks(get, set, downloadReducer(get().tasks, action));
    const isActive = () =>
      get().tasks.some((t) => t.id === id && t.status === "downloading");
    let local: LocalDownload;
    try {
      const task = api.createDownloadTask(
        opts.url,
        opts.filename,
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (!isActive()) return;
          apply({ type: "progress", id, written: totalBytesWritten, expected: totalBytesExpectedToWrite });
        },
        { authenticated: opts.authenticated, cacheKey: id },
      );
      if (!task) throw new Error("Attachment download URL is unavailable");
      cancelHandles.set(id, task.cancel);
      local = await task.done;
    } catch (err: unknown) {
      if (err instanceof DownloadCancelledError || !isActive()) {
        apply({ type: "cancel", id, at: Date.now() });
        return { status: "cancelled" };
      }
      const message = err instanceof Error ? err.message : "Attachment download failed";
      apply({ type: "fail", id, error: message, at: Date.now() });
      return { status: "failed", error: message };
    } finally {
      cancelHandles.delete(id);
    }

    // A late native success after cancel/delete must not open or install a file.
    if (!isActive()) {
      await deleteLocalFile(local.uri, id, opts.filename);
      return { status: "cancelled" };
    }

    apply({ type: "complete", id, localUri: local.uri, at: Date.now() });
    // Completion errors are not transfer errors, even if history was meanwhile cleared.
    if (opts.onCompleted) {
      await opts.onCompleted(local);
    } else {
      void Sharing.shareAsync(local.uri, {
        mimeType: opts.mimeType ?? mimeTypeForFilename(local.name),
      }).catch(() => {});
    }
    return { status: "completed", localUri: local.uri };
  }

  return {
    tasks: [],
    hydrated: false,

    hydrate: () => {
      if (get().hydrated) return Promise.resolve();
      hydration ??= readPersistedTasks()
        .then((persisted) => set({ tasks: trimHistory(persisted), hydrated: true }))
        .finally(() => { hydration = undefined; });
      return hydration;
    },

    downloadAndOpen: async (url, filename, mimeType, source) => {
      const { id } = await get().downloadManaged({
        url,
        filename,
        mimeType,
        source,
      });
      return { id };
    },

    downloadManaged: async (opts) => {
      await ensureHydrated();
      const options = {
        ...opts,
        filename: sanitizeBasename(opts.filename) || "download",
        source: opts.source ?? { kind: "other" } as const,
        authenticated: opts.authenticated !== false,
      };
      // A different auth or completion policy cannot borrow another transfer.
      // Match callbacks by identity; About and Retry share the APK handler.
      for (const task of get().tasks) {
        if (task.status !== "downloading") continue;
        const active = inFlightDownloads.get(task.id);
        if (
          active &&
          active.options.url === options.url &&
          active.options.filename === options.filename &&
          active.options.authenticated === options.authenticated &&
          active.options.source?.kind === options.source.kind &&
          active.options.mimeType === options.mimeType &&
          active.options.onCompleted === options.onCompleted
        ) return { id: task.id, done: active.done };
      }

      const id = createRequestId();
      const action: DownloadAction = {
        type: "begin",
        id,
        filename: options.filename,
        url: options.url,
        mimeType: options.mimeType,
        source: options.source,
        createdAt: Date.now(),
      };
      applyTasks(get, set, downloadReducer(get().tasks, action));
      const done = runDownload(id, options);
      inFlightDownloads.set(id, { options, done });
      const forget = () => { inFlightDownloads.delete(id); };
      void done.then(forget, forget);
      return { id, done };
    },

    cancel: async (id) => {
      await ensureHydrated();
      const task = get().tasks.find((t) => t.id === id);
      if (!task || task.status !== "downloading") return;
      cancelHandles.get(id)?.();
      cancelHandles.delete(id);
      const action: DownloadAction = { type: "cancel", id, at: Date.now() };
      applyTasks(get, set, downloadReducer(get().tasks, action));
    },

    retry: async (id) => {
      await ensureHydrated();
      const task = get().tasks.find((t) => t.id === id);
      if (!task || (task.status !== "failed" && task.status !== "cancelled")) return;
      const isUpdate = task.source.kind === "update";
      return get().downloadManaged({
        url: task.url,
        filename: task.filename,
        mimeType: task.mimeType,
        source: task.source,
        authenticated: !isUpdate,
        onCompleted: isUpdate ? installDownloadedUpdate : undefined,
      });
    },

    removeTask: async (id) => {
      await ensureHydrated();
      const task = get().tasks.find((t) => t.id === id);
      cancelHandles.get(id)?.();
      cancelHandles.delete(id);
      inFlightDownloads.delete(id);
      const action: DownloadAction = { type: "remove", id };
      applyTasks(get, set, downloadReducer(get().tasks, action));
      await deleteLocalFile(task?.localUri, id, task?.filename);
    },

    clearFinished: async () => {
      await ensureHydrated();
      const removed = get().tasks.filter((t) => isTerminalStatus(t.status));
      const removedIds = new Set(removed.map((t) => t.id));
      await Promise.all(removed.map((t) => deleteLocalFile(t.localUri, t.id, t.filename)));
      applyTasks(get, set, get().tasks.filter((t) => !removedIds.has(t.id)));
    },
  };
});

/** Number of in-flight downloads — the More-menu badge reads this. */
export function useActiveDownloadCount(): number {
  return useDownloadsStore((s) => activeDownloadCount(s.tasks));
}
