/**
 * Durable ledger for cancelled-prompt restores — the piece that makes the
 * composer hand-off *at most once*.
 *
 * Two things live here, both per workspace (mirroring web's `wsKey(...)`
 * storage scoping in `packages/core/chat/store.ts`):
 *
 *   - `appliedDraftRestoreIds` — durable restores already written into a
 *     composer. Recorded BEFORE the consume request goes out, so a consume that
 *     is lost (offline, app killed, retries exhausted) cannot cause the prompt
 *     to be restored a second time after the user has sent it. The ledger, not
 *     the server row, is what suppresses the re-offer; entries are dropped only
 *     once the server confirms the row is gone.
 *   - `pendingSendRestores` — restores with no server copy left (a synchronous
 *     cancel response, or a failed send). Their text exists nowhere else, so
 *     they are queued per session and survive a restart. FIFO, so two failures
 *     against the same session are both recovered, oldest first.
 *
 * Persistence is a per-workspace JSON file through `expo-file-system` (same
 * best-effort pattern as `issue-create-settings-store` / `downloads-store` —
 * the app has no AsyncStorage dependency and `File` is already in the tree).
 * Every write failure is swallowed: losing the ledger costs a duplicate draft,
 * not the prompt, and it must never break the composer.
 *
 * Why persisted at all, when the drafts store is in-memory: a durable restore's
 * apply→consume gap is exactly the window in which the app gets killed, and an
 * in-memory ledger would re-offer a prompt the user already sent.
 */
import { create } from "zustand";
import { File, Paths } from "expo-file-system";
import type {
  PendingSendRestore,
  RestoreDraftRequest,
} from "@/lib/chat-draft-restore";
import {
  dequeuePendingRestore,
  enqueuePendingRestore,
  forgetRestoreApplied,
  markRestoreApplied,
} from "@/lib/chat-draft-restore";

interface PersistedShape {
  applied: string[];
  queue: Record<string, PendingSendRestore[]>;
}

interface ChatDraftRestoreState {
  appliedByWorkspace: Record<string, string[]>;
  queueByWorkspace: Record<string, Record<string, PendingSendRestore[]>>;
  hydrated: Record<string, boolean>;
  /** Read this workspace's ledger once, on first composer mount. */
  hydrate: (wsId: string) => Promise<void>;
  /** Record a durable restore as applied. Call before firing the consume. */
  markApplied: (wsId: string, restoreId: string) => void;
  /** Server confirmed the row is gone — the ledger entry has nothing left to
   *  protect against. */
  forgetApplied: (wsId: string, restoreId: string) => void;
  /** Queue a server-less restore for its own session. */
  enqueue: (wsId: string, restore: PendingSendRestore) => void;
  /** Drop a queued restore once its text is safely in the (persisted) draft. */
  dequeue: (wsId: string, sessionId: string, restoreId: string) => void;
}

/** Serialize file writes so a burst of ledger updates can't interleave. */
let persistChain: Promise<void> = Promise.resolve();

function ledgerFile(wsId: string): File {
  return new File(Paths.document, `multica-chat-draft-restore-${wsId}.json`);
}

function persist(wsId: string, applied: string[], queue: Record<string, PendingSendRestore[]>): void {
  persistChain = persistChain
    .then(() => {
      ledgerFile(wsId).write(JSON.stringify({ applied, queue }));
    })
    .catch(() => {
      // Best-effort: a failed write must not break the restore flow.
    });
}

/** Filter an untrusted persisted payload down to the shape we can use. A
 *  corrupt / legacy file degrades to "nothing recorded", which costs at most a
 *  duplicate draft. */
function readPersisted(raw: unknown): PersistedShape {
  const empty: PersistedShape = { applied: [], queue: {} };
  if (!raw || typeof raw !== "object") return empty;
  const v = raw as { applied?: unknown; queue?: unknown };
  const applied = Array.isArray(v.applied)
    ? v.applied.filter((id): id is string => typeof id === "string")
    : [];
  const queue: Record<string, PendingSendRestore[]> = {};
  if (v.queue && typeof v.queue === "object") {
    for (const [sessionId, rows] of Object.entries(
      v.queue as Record<string, unknown>,
    )) {
      if (!Array.isArray(rows)) continue;
      const valid = rows.filter(isPendingRestore);
      if (valid.length > 0) queue[sessionId] = valid;
    }
  }
  return { applied, queue };
}

function isPendingRestore(value: unknown): value is PendingSendRestore {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.content === "string" &&
    typeof v.sessionId === "string" &&
    v.sessionId.length > 0
  );
}

export const useChatDraftRestoreStore = create<ChatDraftRestoreState>(
  (set, get) => ({
    appliedByWorkspace: {},
    queueByWorkspace: {},
    hydrated: {},

    hydrate: async (wsId) => {
      // Mark hydrated up front so concurrent mounts dedupe the read. Re-hydrating
      // would be actively harmful: it would let a stale file overwrite an entry
      // recorded since.
      if (get().hydrated[wsId]) return;
      set((s) => ({ hydrated: { ...s.hydrated, [wsId]: true } }));
      let persisted: PersistedShape = { applied: [], queue: {} };
      try {
        const file = ledgerFile(wsId);
        if (file.exists) {
          persisted = readPersisted(JSON.parse(await file.text()) as unknown);
        }
      } catch {
        // Corrupt / unreadable ledger is not worth crashing over.
        persisted = { applied: [], queue: {} };
      }
      set((s) => {
        // A restore may have been recorded while the file read was in flight —
        // never clobber what this session already knows.
        const applied = s.appliedByWorkspace[wsId];
        const queue = s.queueByWorkspace[wsId];
        if (applied !== undefined || queue !== undefined) return s;
        return {
          appliedByWorkspace: { ...s.appliedByWorkspace, [wsId]: persisted.applied },
          queueByWorkspace: { ...s.queueByWorkspace, [wsId]: persisted.queue },
        };
      });
    },

    markApplied: (wsId, restoreId) =>
      set((s) => {
        const current = s.appliedByWorkspace[wsId] ?? [];
        const next = markRestoreApplied(current, restoreId);
        if (next === current) return s;
        persist(wsId, next, s.queueByWorkspace[wsId] ?? {});
        return { appliedByWorkspace: { ...s.appliedByWorkspace, [wsId]: next } };
      }),

    forgetApplied: (wsId, restoreId) =>
      set((s) => {
        const current = s.appliedByWorkspace[wsId] ?? [];
        const next = forgetRestoreApplied(current, restoreId);
        if (next === current) return s;
        persist(wsId, next, s.queueByWorkspace[wsId] ?? {});
        return { appliedByWorkspace: { ...s.appliedByWorkspace, [wsId]: next } };
      }),

    enqueue: (wsId, restore) =>
      set((s) => {
        const current = s.queueByWorkspace[wsId] ?? {};
        const next = enqueuePendingRestore(current, restore);
        if (next === current) return s;
        persist(wsId, s.appliedByWorkspace[wsId] ?? [], next);
        return { queueByWorkspace: { ...s.queueByWorkspace, [wsId]: next } };
      }),

    dequeue: (wsId, sessionId, restoreId) =>
      set((s) => {
        const current = s.queueByWorkspace[wsId] ?? {};
        const next = dequeuePendingRestore(current, sessionId, restoreId);
        if (next === current) return s;
        persist(wsId, s.appliedByWorkspace[wsId] ?? [], next);
        return { queueByWorkspace: { ...s.queueByWorkspace, [wsId]: next } };
      }),
  }),
);

/** The ledger entry a caller builds for a durable row — one place so the
 *  request id, the server row id and the target session can't drift apart. */
export function durableRestoreRequest(row: {
  id: string;
  chat_session_id: string;
  content?: string;
  attachments?: RestoreDraftRequest["attachments"];
}): RestoreDraftRequest {
  return {
    id: row.id,
    content: row.content ?? "",
    attachments: row.attachments,
    sessionId: row.chat_session_id,
    serverRestoreId: row.id,
  };
}
