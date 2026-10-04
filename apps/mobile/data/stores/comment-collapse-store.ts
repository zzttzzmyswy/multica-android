/**
 * Which comments are folded, per workspace, per device.
 *
 * Web keeps the same state in `packages/core/issues/stores/
 * comment-collapse-store.ts` (`collapsedByIssue`, localStorage, workspace-
 * aware storage). Mobile mirrors the CONTRACT — only folded ids are stored,
 * expanded is the default; a fold never travels between machines and has no
 * API — but persists to a per-workspace JSON file through `expo-file-system`,
 * the same best-effort pattern as `issue-workbench-layout-store.ts` and
 * `issue-create-settings-store.ts`. No AsyncStorage dependency is added.
 *
 * Scope note: web's store is keyed by issue id alone (its localStorage is
 * already workspace-scoped by the storage adapter). Mobile namespaces the
 * FILE by workspace instead, so a comment id from one workspace can never
 * fold a row in another even if the ids were to collide.
 *
 * Only `isCollapsed` / `toggle` are ported. Web also exposes `collapseAll` /
 * `expandAll`, driven by its "collapse resolved thread" bar; mobile has no
 * such control, and adding one would be a new surface rather than parity.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { Paths, File } from "expo-file-system";
import {
  isCommentCollapsed,
  normalizeCollapsedComments,
  toggleCollapsedComment,
} from "@/lib/comment-collapse";

interface CommentCollapseState {
  /** `wsId` → `issueId` → folded comment ids. */
  byWorkspace: Partial<Record<string, Record<string, string[]>>>;
  /** Workspaces already hydrated — guards the async file read from stamping
   *  values on every mount (a fold made during the read must survive it). */
  hydrated: Record<string, boolean>;
  hydrate: (wsId: string) => Promise<void>;
  isCollapsed: (wsId: string, issueId: string, commentId: string) => boolean;
  toggle: (wsId: string, issueId: string, commentId: string) => void;
}

/** Serialize file writes so a burst of folds can't interleave. */
let persistChain: Promise<void> = Promise.resolve();

function collapseFile(wsId: string): File {
  return new File(Paths.document, `multica-comment-collapse-${wsId}.json`);
}

function persist(wsId: string, collapsed: Record<string, string[]>): void {
  persistChain = persistChain
    .then(() => {
      collapseFile(wsId).write(JSON.stringify(collapsed));
    })
    .catch(() => {
      // Persistence is best-effort; a failed write must not break the UI.
    });
}

export const useCommentCollapseStore = create<CommentCollapseState>((set, get) => ({
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
      const file = collapseFile(wsId);
      if (file.exists) raw = JSON.parse(await file.text()) as unknown;
    } catch {
      // Corrupt/unreadable folds are not worth crashing over.
      raw = null;
    }
    const normalized = normalizeCollapsedComments(raw);
    set((s) => {
      // A fold may have landed while the file read was in flight — never
      // clobber a value the user already set this session.
      if (s.byWorkspace[wsId] !== undefined) return s;
      return { byWorkspace: { ...s.byWorkspace, [wsId]: normalized } };
    });
  },

  isCollapsed: (wsId, issueId, commentId) =>
    isCommentCollapsed(get().byWorkspace[wsId]?.[issueId], commentId),

  toggle: (wsId, issueId, commentId) =>
    set((s) => {
      const current = s.byWorkspace[wsId] ?? {};
      const nextList = toggleCollapsedComment(current[issueId] ?? [], commentId);
      const next = { ...current };
      if (nextList.length === 0) delete next[issueId];
      else next[issueId] = nextList;
      persist(wsId, next);
      return { byWorkspace: { ...s.byWorkspace, [wsId]: next } };
    }),
}));

/**
 * Is one comment folded, hydrating the workspace's file once on first read.
 * Returns a plain boolean, so a card only re-renders when ITS OWN fold
 * changes — not on every write anywhere in the workspace.
 */
export function useIsCommentCollapsed(
  wsId: string | null,
  issueId: string,
  commentId: string,
): boolean {
  const collapsed = useCommentCollapseStore((s) =>
    wsId ? s.byWorkspace[wsId]?.[issueId] : undefined,
  );
  const hydrate = useCommentCollapseStore((s) => s.hydrate);
  useEffect(() => {
    if (wsId) void hydrate(wsId);
  }, [wsId, hydrate]);
  return isCommentCollapsed(collapsed, commentId);
}

/** The toggle for one comment. Stable across renders (zustand action). */
export function useToggleCommentCollapsed(): (
  wsId: string,
  issueId: string,
  commentId: string,
) => void {
  return useCommentCollapseStore((s) => s.toggle);
}
