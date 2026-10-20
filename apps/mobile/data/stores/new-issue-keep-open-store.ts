/**
 * "Create another" — whether the New Issue form stays open after a successful
 * submit so the user can file the next task without reopening it.
 *
 * Web keeps this in `packages/core/issues/stores/quick-create-store.ts`
 * (`keepOpen` + `setKeepOpen`, zustand `persist`, localStorage key
 * `multica_quick_create`). It is a STANDING PREFERENCE, not a per-submit
 * switch: tick it once and every subsequent create keeps the form open until
 * the user unticks it. Mobile had no equivalent at all — `new-issue.tsx`
 * called `router.back()` unconditionally after every create, so filing five
 * tasks meant opening the form five times and re-picking the parent and
 * project each time.
 *
 * Persistence follows the same best-effort per-workspace JSON-file pattern as
 * `issue-create-settings-store.ts` / `comment-collapse-store.ts` — the value
 * is a workspace-shaped preference (the same user may batch-file in one
 * workspace and not another), and no AsyncStorage dependency is added.
 *
 * Why the reset-on-next-issue rules live in a separate pure module
 * (`lib/new-issue-keep-open.ts`) rather than here: they are the part with the
 * interesting failure modes (which fields survive, which must not), and a
 * pure function can be tested and mutated without a renderer.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { Paths, File } from "expo-file-system";
import { normalizeKeepOpen } from "@/lib/new-issue-keep-open-persist";

interface NewIssueKeepOpenState {
  /** `wsId` → whether the form should stay open after a submit. Absent = false. */
  byWorkspace: Partial<Record<string, boolean>>;
  /** Workspaces already hydrated — guards the async file read from stamping a
   *  value over a toggle the user just made this session. */
  hydrated: Record<string, boolean>;
  hydrate: (wsId: string) => Promise<void>;
  setKeepOpen: (wsId: string, value: boolean) => void;
}

/** Serialize file writes so a burst of toggles can't interleave. */
let persistChain: Promise<void> = Promise.resolve();

function keepOpenFile(wsId: string): File {
  return new File(Paths.document, `multica-new-issue-keep-open-${wsId}.json`);
}

function persist(wsId: string, value: boolean): void {
  persistChain = persistChain
    .then(() => {
      keepOpenFile(wsId).write(JSON.stringify({ keepOpen: value }));
    })
    .catch(() => {
      // Persistence is best-effort; a failed write must not break the toggle.
    });
}

/** An untrusted persisted payload → the flag. The rule (and why it is strict)
 *  lives in `lib/new-issue-keep-open-persist.ts` so it is testable without
 *  dragging React Native into the test process. */
export { normalizeKeepOpen } from "@/lib/new-issue-keep-open-persist";

export const useNewIssueKeepOpenStore = create<NewIssueKeepOpenState>(
  (set) => ({
    byWorkspace: {},
    hydrated: {},

    hydrate: async (wsId) => {
      // Mark hydrated up front so concurrent mounts dedupe the read.
      set((s) => {
        if (s.hydrated[wsId]) return s;
        return { hydrated: { ...s.hydrated, [wsId]: true } };
      });
      let raw: unknown = null;
      try {
        const file = keepOpenFile(wsId);
        if (file.exists) raw = JSON.parse(await file.text()) as unknown;
      } catch {
        // Corrupt/unreadable preference is not worth crashing over.
        raw = null;
      }
      const value = normalizeKeepOpen(raw);
      set((s) => {
        // A toggle may have landed while the file read was in flight — never
        // clobber a value the user already set this session.
        if (s.byWorkspace[wsId] !== undefined) return s;
        return { byWorkspace: { ...s.byWorkspace, [wsId]: value } };
      });
    },

    setKeepOpen: (wsId, value) => {
      persist(wsId, value);
      set((s) => ({ byWorkspace: { ...s.byWorkspace, [wsId]: value } }));
    },
  }),
);

/**
 * Read the flag for one workspace, hydrating its file once on first read.
 * Returns a plain boolean so the form only re-renders when ITS workspace's
 * preference changes.
 */
export function useNewIssueKeepOpen(wsId: string | null): boolean {
  const value = useNewIssueKeepOpenStore((s) =>
    wsId ? s.byWorkspace[wsId] : undefined,
  );
  const hydrate = useNewIssueKeepOpenStore((s) => s.hydrate);
  useEffect(() => {
    if (wsId) void hydrate(wsId);
  }, [wsId, hydrate]);
  return value === true;
}
