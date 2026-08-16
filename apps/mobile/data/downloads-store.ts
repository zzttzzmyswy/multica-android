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
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { api, DownloadCancelledError, type LocalDownload } from "@/data/api";
import { mimeTypeForFilename, sanitizeBasename } from "@/lib/attachment-download";
import { createRequestId } from "@/lib/request-id";
import {
  activeDownloadCount,
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

async function deleteLocalFile(localUri: string | null | undefined) {
  if (!localUri) return;
  try {
    const file = new File(localUri);
    if (file.exists) file.delete();
  } catch {
    // Best-effort cleanup; the row is removed regardless.
  }
}

interface DownloadsState {
  tasks: DownloadTask[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  /** Enqueue + run an authenticated download. On completion opens the system
   *  share sheet. Dedups same-URL+name downloads already in flight. */
  downloadAndOpen: (
    url: string,
    filename: string,
    mimeType?: string,
    source?: DownloadSource,
  ) => Promise<{ id: string }>;
  cancel: (id: string) => void;
  retry: (id: string) => void;
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
  async function ensureHydrated(): Promise<void> {
    if (!get().hydrated) await get().hydrate();
  }

  /** Drive the native download and fold its lifecycle into the task list.
   *   - complete  → share sheet + `completed` row;
   *   - cancelled → `cancelled` row (the UI already marked it or the native
   *     task aborted);
   *   - other errors → `failed` row with the API message. */
  function runDownload(
    id: string,
    url: string,
    filename: string,
    mimeType: string | undefined,
    source: DownloadSource,
  ): void {
    const task = api.createDownloadTask(
      url,
      filename,
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        const action: DownloadAction = {
          type: "progress",
          id,
          written: totalBytesWritten,
          expected: totalBytesExpectedToWrite,
        };
        applyTasks(get, set, downloadReducer(get().tasks, action));
      },
    );

    if (!task) {
      const action: DownloadAction = {
        type: "fail",
        id,
        error: "Attachment download URL is unavailable",
        at: Date.now(),
      };
      applyTasks(get, set, downloadReducer(get().tasks, action));
      return;
    }

    cancelHandles.set(id, task.cancel);

    void task.done
      .then((local: LocalDownload) => {
        cancelHandles.delete(id);
        const action: DownloadAction = {
          type: "complete",
          id,
          localUri: local.uri,
          at: Date.now(),
        };
        applyTasks(get, set, downloadReducer(get().tasks, action));
        const shareMime = mimeType ?? mimeTypeForFilename(local.name);
        // Open is fire-and-forget; a missing viewer must not flip a
        // completed download back to failed.
        void Sharing.shareAsync(local.uri, { mimeType: shareMime }).catch(
          () => {},
        );
      })
      .catch((err: unknown) => {
        cancelHandles.delete(id);
        const cancelled =
          err instanceof DownloadCancelledError ||
          // The user already hit cancel in the UI first.
          get().tasks.some((t) => t.id === id && t.status === "cancelled");
        const action: DownloadAction = cancelled
          ? { type: "cancel", id, at: Date.now() }
          : {
              type: "fail",
              id,
              error:
                err instanceof Error
                  ? err.message
                  : "Attachment download failed",
              at: Date.now(),
            };
        applyTasks(get, set, downloadReducer(get().tasks, action));
      });
  }

  return {
    tasks: [],
    hydrated: false,

    hydrate: async () => {
      if (get().hydrated) return;
      const persisted = await readPersistedTasks();
      set({ tasks: trimHistory(persisted), hydrated: true });
    },

    downloadAndOpen: async (url, filename, mimeType, source) => {
      await ensureHydrated();
      const safeName = sanitizeBasename(filename) || "download";
      // Dedup: same URL + same safe name already downloading → reuse it.
      const inFlight = get().tasks.find(
        (t) =>
          t.status === "downloading" &&
          t.url === url &&
          t.filename === safeName,
      );
      if (inFlight) return { id: inFlight.id };

      const id = createRequestId();
      const now = Date.now();
      const action: DownloadAction = {
        type: "begin",
        id,
        filename: safeName,
        url,
        mimeType,
        source: source ?? { kind: "other" },
        createdAt: now,
      };
      applyTasks(get, set, downloadReducer(get().tasks, action));
      runDownload(id, url, safeName, mimeType, source ?? { kind: "other" });
      return { id };
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
      if (!task || task.status === "downloading") return;
      const newId = createRequestId();
      const now = Date.now();
      const action: DownloadAction = {
        type: "begin",
        id: newId,
        filename: task.filename,
        url: task.url,
        mimeType: task.mimeType,
        source: task.source,
        createdAt: now,
      };
      applyTasks(get, set, downloadReducer(get().tasks, action));
      runDownload(newId, task.url, task.filename, task.mimeType, task.source);
    },

    removeTask: async (id) => {
      await ensureHydrated();
      const task = get().tasks.find((t) => t.id === id);
      cancelHandles.get(id)?.();
      cancelHandles.delete(id);
      await deleteLocalFile(task?.localUri);
      const action: DownloadAction = { type: "remove", id };
      applyTasks(get, set, downloadReducer(get().tasks, action));
    },

    clearFinished: async () => {
      await ensureHydrated();
      const active = get().tasks.filter((t) => t.status === "downloading");
      const removed = get().tasks.filter((t) => isTerminalStatus(t.status));
      await Promise.all(removed.map((t) => deleteLocalFile(t.localUri)));
      set({ tasks: active });
      if (get().hydrated) writePersistedTasks(active);
    },
  };
});

/** Number of in-flight downloads — the More-menu badge reads this. */
export function useActiveDownloadCount(): number {
  return useDownloadsStore((s) => activeDownloadCount(s.tasks));
}