/**
 * Per-workspace, per-device workbench layout — the swimlane row order, which
 * swimlanes are folded, and which issue-list sections are folded.
 *
 * Web keeps the same three in `packages/core/issues/stores/view-store.ts`
 * (`swimlaneOrders`, `collapsedSwimlanes`, `listCollapsedStatuses`) backed by
 * localStorage. They are NOT part of a saved view's payload — web's
 * `save-view-dialog.tsx` serialises only the filter and display keys — so
 * they never travel between machines and there is no API for them. Mobile
 * mirrors that with a per-workspace JSON file through `expo-file-system`,
 * the same best-effort pattern as `issue-create-settings-store.ts` and
 * `downloads-store.ts`. No AsyncStorage dependency is introduced.
 *
 * Bucket keys, and why they are not a single flat list:
 *   - `swimlane:<grouping>` — one bucket per swimlane dimension, holding RAW
 *     lane ids (`member:m1`, a project id, `none`, `orphan`). Switching
 *     dimension must not carry a fold from one board to the next; web keys
 *     the same way (`collapsedSwimlanes[grouping]`) and namespaces the ids
 *     at the component (`<grouping>:<rawId>`) so the store stays
 *     grouping-agnostic. The ids stored here are already namespaced by the
 *     caller, which keeps the two lookups identical.
 *   - `list` — the issue list's folded sections, keyed by SECTION KEY
 *     (`todo`, `member:m1`, `none`). Web stores an `IssueStatus[]` because
 *     its list only groups by status; mobile's list also groups by assignee
 *     and by select property, so the key has to be the section's own key.
 *   - `swimlaneOrder:<grouping>` — the dragged lane order per dimension.
 */
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { Paths, File } from "expo-file-system";
import type { SwimlaneGrouping } from "@/lib/swimlane";
import {
  collapseSections,
  normalizeBuckets,
  normalizeKeyList,
  toggleCollapsedKey,
} from "@/lib/workbench-layout";

/** Folded-section buckets, keyed by `<grouping>` / `list`. */
export type CollapsedBuckets = Record<string, string[]>;
/** Lane orders, keyed by swimlane grouping. */
export type LaneOrders = Partial<Record<SwimlaneGrouping, string[]>>;

export interface WorkspaceWorkbenchLayout {
  collapsed: CollapsedBuckets;
  laneOrders: LaneOrders;
}

export function defaultWorkbenchLayout(): WorkspaceWorkbenchLayout {
  return { collapsed: {}, laneOrders: {} };
}

/** Folded-section bucket name for a swimlane dimension. */
export function swimlaneBucket(grouping: SwimlaneGrouping): string {
  return `swimlane:${grouping}`;
}

/** Folded-section bucket name for the issue list. */
export const LIST_BUCKET = "list";

interface WorkbenchLayoutState {
  byWorkspace: Partial<Record<string, WorkspaceWorkbenchLayout>>;
  /** Workspaces already hydrated — guards the async file read from stamping
   *  values on every mount (a fold made during the read must survive it). */
  hydrated: Record<string, boolean>;
  hydrate: (wsId: string) => Promise<void>;
  toggleCollapsed: (wsId: string, bucket: string, key: string) => void;
  setLaneOrder: (
    wsId: string,
    grouping: SwimlaneGrouping,
    order: string[],
  ) => void;
}

/** Serialize file writes so a burst of folds can't interleave. */
let persistChain: Promise<void> = Promise.resolve();

function layoutFile(wsId: string): File {
  return new File(Paths.document, `multica-workbench-layout-${wsId}.json`);
}

function persist(wsId: string, layout: WorkspaceWorkbenchLayout): void {
  persistChain = persistChain
    .then(() => {
      layoutFile(wsId).write(JSON.stringify(layout));
    })
    .catch(() => {
      // Persistence is best-effort; a failed write must not break the UI.
    });
}

/** Normalize an untrusted persisted layout. Unknown groupings are dropped
 *  from `laneOrders` (the union is closed) but kept in `collapsed`, whose
 *  bucket namespace is open by design — a bucket written by a newer build
 *  must survive a downgrade rather than be silently deleted. */
function normalizeLayout(raw: unknown): WorkspaceWorkbenchLayout {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultWorkbenchLayout();
  }
  const record = raw as Record<string, unknown>;
  const collapsed = normalizeBuckets(record.collapsed);
  const orders: LaneOrders = {};
  const rawOrders = record.laneOrders;
  if (rawOrders && typeof rawOrders === "object" && !Array.isArray(rawOrders)) {
    for (const grouping of ["assignee", "project", "parent"] as const) {
      const list = normalizeKeyList(
        (rawOrders as Record<string, unknown>)[grouping],
      );
      if (list.length > 0) orders[grouping] = list;
    }
  }
  return { collapsed, laneOrders: orders };
}

export const useWorkbenchLayoutStore = create<WorkbenchLayoutState>((set) => ({
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
      const file = layoutFile(wsId);
      if (file.exists) raw = JSON.parse(await file.text()) as unknown;
    } catch {
      // Corrupt/unreadable layout is not worth crashing over.
      raw = null;
    }
    const normalized = normalizeLayout(raw);
    set((s) => {
      // A fold may have landed while the file read was in flight — never
      // clobber a value the user already set this session.
      if (s.byWorkspace[wsId] !== undefined) return s;
      return { byWorkspace: { ...s.byWorkspace, [wsId]: normalized } };
    });
  },

  toggleCollapsed: (wsId, bucket, key) =>
    set((s) => {
      const current = s.byWorkspace[wsId] ?? defaultWorkbenchLayout();
      const list = current.collapsed[bucket] ?? [];
      const nextList = toggleCollapsedKey(list, key);
      const collapsed = { ...current.collapsed };
      if (nextList.length === 0) delete collapsed[bucket];
      else collapsed[bucket] = nextList;
      const next = { ...current, collapsed };
      persist(wsId, next);
      return { byWorkspace: { ...s.byWorkspace, [wsId]: next } };
    }),

  setLaneOrder: (wsId, grouping, order) =>
    set((s) => {
      const current = s.byWorkspace[wsId] ?? defaultWorkbenchLayout();
      const next = {
        ...current,
        laneOrders: { ...current.laneOrders, [grouping]: [...order] },
      };
      persist(wsId, next);
      return { byWorkspace: { ...s.byWorkspace, [wsId]: next } };
    }),
}));

/**
 * Read the current workspace's layout, hydrating the store once on first
 * read. Returns the shared default until the file resolves; the selectors
 * below return the stored object itself (never a fresh one), so a component
 * does not re-render on every store write elsewhere.
 */
function useWorkspaceLayout(wsId: string | null): WorkspaceWorkbenchLayout {
  const layout = useWorkbenchLayoutStore((s) =>
    wsId ? s.byWorkspace[wsId] : undefined,
  );
  const hydrate = useWorkbenchLayoutStore((s) => s.hydrate);
  useEffect(() => {
    if (wsId) void hydrate(wsId);
  }, [wsId, hydrate]);
  return layout ?? defaultWorkbenchLayout();
}

/** Folded keys of one bucket, for a surface that renders that bucket. The
 *  Set is memoized on the stored array, so it is stable across renders that
 *  do not change the fold — safe to name in a `useMemo` dependency list. */
export function useCollapsedKeys(
  wsId: string | null,
  bucket: string,
): ReadonlySet<string> {
  const layout = useWorkspaceLayout(wsId);
  const list = layout.collapsed[bucket];
  return useMemo(() => new Set(list ?? []), [list]);
}

/** The toggle for one bucket. */
export function useToggleCollapsed(
  wsId: string | null,
  bucket: string,
): (key: string) => void {
  const toggle = useWorkbenchLayoutStore((s) => s.toggleCollapsed);
  return (key: string) => {
    if (wsId) toggle(wsId, bucket, key);
  };
}

/** The persisted lane order for one swimlane dimension. */
export function useLaneOrder(
  wsId: string | null,
  grouping: SwimlaneGrouping,
): readonly string[] {
  const layout = useWorkspaceLayout(wsId);
  return layout.laneOrders[grouping] ?? EMPTY_ORDER;
}

const EMPTY_ORDER: readonly string[] = [];

/** The setter for one swimlane dimension's lane order. */
export function useSetLaneOrder(
  wsId: string | null,
  grouping: SwimlaneGrouping,
): (order: string[]) => void {
  const setOrder = useWorkbenchLayoutStore((s) => s.setLaneOrder);
  return (order: string[]) => {
    if (wsId) setOrder(wsId, grouping, order);
  };
}

/**
 * The issue list's fold state, applied to a surface's own sections.
 *
 * Returns the sections with folded ones emptied (header kept, rows gone —
 * see `collapseSections`), the collapsed key set, and the toggle. Memoized on
 * the inputs so a re-render that changes neither does not hand `SectionList`
 * a fresh array.
 */
export function useListSectionFolding<
  T extends { key: string; data: unknown[] },
>(
  wsId: string | null,
  sections: readonly T[],
): {
  sections: T[];
  collapsed: ReadonlySet<string>;
  toggle: (key: string) => void;
} {
  const collapsed = useCollapsedKeys(wsId, LIST_BUCKET);
  const toggle = useToggleCollapsed(wsId, LIST_BUCKET);
  const folded = useMemo(
    () => collapseSections(sections, collapsed),
    [sections, collapsed],
  );
  return { sections: folded, collapsed, toggle };
}
