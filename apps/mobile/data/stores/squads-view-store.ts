/**
 * Per-workspace, per-device squads-list view state — the chosen sort field and
 * direction plus the leader/creator filters.
 *
 * Web keeps the same three (plus scope and column visibility) in
 * `packages/core/squads/stores/view-store.ts` behind localStorage. Mobile
 * mirrors only sort + filters with a per-workspace JSON file through
 * `expo-file-system`, the same best-effort pattern as
 * `issue-workbench-layout-store.ts` and `downloads-store.ts`. No AsyncStorage
 * dependency is introduced.
 *
 * Two keys web persists are deliberately absent here:
 *   - `scope` stays session-local (the squads screen documents why: a stored
 *     `mine` on a phone that later switches account opens an unexplained empty
 *     list).
 *   - `hiddenColumns` has no mobile analogue — a row is a card, not a table
 *     row with hideable columns. Storing it would be state nothing reads.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { Paths, File } from "expo-file-system";
import {
  EMPTY_SQUAD_FILTERS,
  SQUAD_SORT_DEFAULT_DIRECTION,
  SQUAD_SORT_FIELDS,
  type SquadListFilters,
  type SquadSortDirection,
  type SquadSortField,
} from "@/lib/filter-squads";

export interface SquadsViewState {
  sortField: SquadSortField;
  sortDirection: SquadSortDirection;
  filters: SquadListFilters;
}

export function defaultSquadsViewState(): SquadsViewState {
  return {
    sortField: "name",
    sortDirection: SQUAD_SORT_DEFAULT_DIRECTION.name,
    filters: EMPTY_SQUAD_FILTERS,
  };
}

const DEFAULT_VIEW: SquadsViewState = defaultSquadsViewState();

interface SquadsViewStoreState {
  byWorkspace: Partial<Record<string, SquadsViewState>>;
  /** Workspaces already hydrated — guards the async file read from stamping
   *  values on every mount (a sort made during the read must survive it). */
  hydrated: Record<string, boolean>;
  hydrate: (wsId: string) => Promise<void>;
  setSort: (
    wsId: string,
    field: SquadSortField,
    direction: SquadSortDirection,
  ) => void;
  toggleFilter: (wsId: string, key: string) => void;
  clearFilters: (wsId: string) => void;
}

/** Serialize file writes so a burst of toggles can't interleave. */
let persistChain: Promise<void> = Promise.resolve();

function viewFile(wsId: string): File {
  return new File(Paths.document, `multica-squads-view-${wsId}.json`);
}

function persist(wsId: string, state: SquadsViewState): void {
  persistChain = persistChain
    .then(() => {
      viewFile(wsId).write(JSON.stringify(state));
    })
    .catch(() => {
      // Persistence is best-effort; a failed write must not break the UI.
    });
}

function normalizeDirection(value: unknown): SquadSortDirection {
  return value === "desc" ? "desc" : "asc";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** Normalize an untrusted persisted view. An unknown sort field falls back to
 *  the default rather than being kept — the union is closed, and a field the
 *  comparator does not know would sort by the `name` branch while the chip
 *  labelled it something else. */
function normalizeView(raw: unknown): SquadsViewState {
  const fallback = defaultSquadsViewState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const record = raw as Record<string, unknown>;
  const sortField = SQUAD_SORT_FIELDS.includes(record.sortField as SquadSortField)
    ? (record.sortField as SquadSortField)
    : fallback.sortField;
  const rawFilters =
    record.filters && typeof record.filters === "object" && !Array.isArray(record.filters)
      ? (record.filters as Record<string, unknown>)
      : {};
  return {
    sortField,
    sortDirection: normalizeDirection(record.sortDirection),
    filters: {
      leaders: normalizeStringList(rawFilters.leaders),
      creators: normalizeStringList(rawFilters.creators),
    },
  };
}

export const useSquadsViewStore = create<SquadsViewStoreState>((set) => ({
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
      const file = viewFile(wsId);
      if (file.exists) raw = JSON.parse(await file.text()) as unknown;
    } catch {
      // Corrupt/unreadable view is not worth crashing over.
      raw = null;
    }
    const normalized = normalizeView(raw);
    set((s) => {
      // A sort or filter may have landed while the file read was in flight —
      // never clobber a value the user already set this session.
      if (s.byWorkspace[wsId] !== undefined) return s;
      return { byWorkspace: { ...s.byWorkspace, [wsId]: normalized } };
    });
  },

  setSort: (wsId, sortField, sortDirection) =>
    set((s) => {
      const next: SquadsViewState = {
        ...(s.byWorkspace[wsId] ?? DEFAULT_VIEW),
        sortField,
        sortDirection,
      };
      persist(wsId, next);
      return { byWorkspace: { ...s.byWorkspace, [wsId]: next } };
    }),

  toggleFilter: (wsId, key) =>
    set((s) => {
      const separator = key.indexOf(":");
      if (separator <= 0) return s;
      const dimension = key.slice(0, separator);
      const value = key.slice(separator + 1);
      if (!value) return s;
      if (dimension !== "leaders" && dimension !== "creators") return s;
      const current = s.byWorkspace[wsId] ?? DEFAULT_VIEW;
      const list = current.filters[dimension];
      const nextList = list.includes(value)
        ? list.filter((entry) => entry !== value)
        : [...list, value];
      const next: SquadsViewState = {
        ...current,
        filters: { ...current.filters, [dimension]: nextList },
      };
      persist(wsId, next);
      return { byWorkspace: { ...s.byWorkspace, [wsId]: next } };
    }),

  clearFilters: (wsId) =>
    set((s) => {
      const current = s.byWorkspace[wsId] ?? DEFAULT_VIEW;
      const next: SquadsViewState = { ...current, filters: EMPTY_SQUAD_FILTERS };
      persist(wsId, next);
      return { byWorkspace: { ...s.byWorkspace, [wsId]: next } };
    }),
}));

/**
 * Read the current workspace's squads view, hydrating the store once on first
 * read. Returns the shared default until the file resolves; the returned object
 * is the stored one (never a fresh one), so a component does not re-render on
 * every store write elsewhere.
 */
export function useSquadsView(wsId: string | null): SquadsViewState {
  const view = useSquadsViewStore((s) =>
    wsId ? s.byWorkspace[wsId] : undefined,
  );
  const hydrate = useSquadsViewStore((s) => s.hydrate);
  useEffect(() => {
    if (wsId) void hydrate(wsId);
  }, [wsId, hydrate]);
  return view ?? DEFAULT_VIEW;
}
