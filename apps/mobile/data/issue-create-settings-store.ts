/**
 * Issue create settings — which fields each create-issue mode keeps on its
 * toolbar. Mirrors web `packages/core/issues/stores/issue-create-settings-store.ts`
 * semantics on a phone:
 *
 *   - the agent quick-create mode and the manual mode each own a persisted
 *     list of visible toolbar fields;
 *   - a field toggled off stays reachable from the ⋯ overflow and always
 *     re-surfaces while it holds a value (that last rule lives in the form
 *     — see CreateFormAttributeRow);
 *   - persisted arrays are normalized against the canonical field order, so
 *     a toggle sequence never produces two encodings of the same selection.
 *
 * Why per-workspace: the field lists are shaped by workspace resources
 * (project / property lists differ per workspace) exactly like web's
 * workspace-aware storage. Persisted to a per-workspace JSON file through
 * expo-file-system (same best-effort pattern as downloads-store).
 *
 * Mobile's manual field set matches web's full seven (status / priority /
 * assignee / labels / project / due-date / start-date); quick create stays
 * the three-field agent toolbar web defines (no labels/start-date there).
 * Defaults mirror web: quick = project only; manual = the classic five plus
 * labels, with both dates living in the ⋯ overflow until switched on.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { Paths, File } from "expo-file-system";

export type QuickCreateField = "project" | "priority" | "due-date";
export type ManualCreateField =
  | "status"
  | "priority"
  | "assignee"
  | "labels"
  | "project"
  | "due-date"
  | "start-date";

// Canonical field order — the settings rows render in this order and
// setters normalize persisted arrays against it (same contract as web).
export const QUICK_CREATE_FIELDS: QuickCreateField[] = [
  "project",
  "priority",
  "due-date",
];
export const MANUAL_CREATE_FIELDS: ManualCreateField[] = [
  "status",
  "priority",
  "assignee",
  "labels",
  "project",
  "due-date",
  "start-date",
];

// Web mirrors its dialog defaults: quick create shows project only, and
// manual shows the classic five plus labels; both dates live in the
// overflow until toggled on. Same shape as web DEFAULT_MANUAL_CREATE_FIELDS.
export const DEFAULT_QUICK_CREATE_FIELDS: QuickCreateField[] = ["project"];
export const DEFAULT_MANUAL_CREATE_FIELDS: ManualCreateField[] = [
  "status",
  "priority",
  "assignee",
  "labels",
  "project",
];

export interface WorkspaceIssueCreateSettings {
  quick: QuickCreateField[];
  manual: ManualCreateField[];
}

export function defaultIssueCreateSettings(): WorkspaceIssueCreateSettings {
  return {
    quick: [...DEFAULT_QUICK_CREATE_FIELDS],
    manual: [...DEFAULT_MANUAL_CREATE_FIELDS],
  };
}

interface IssueCreateSettingsState {
  byWorkspace: Partial<Record<string, WorkspaceIssueCreateSettings>>;
  /** Workspaces already hydrated — guards the async file read from
   *  stamping values on every mount (see the hydrate clobber test). */
  hydrated: Record<string, boolean>;
  hydrate: (wsId: string) => Promise<void>;
  setQuickCreateFieldVisible: (
    wsId: string,
    field: QuickCreateField,
    visible: boolean,
  ) => void;
  setManualCreateFieldVisible: (
    wsId: string,
    field: ManualCreateField,
    visible: boolean,
  ) => void;
}

function toggleQuick(
  current: QuickCreateField[],
  field: QuickCreateField,
  visible: boolean,
): QuickCreateField[] {
  return QUICK_CREATE_FIELDS.filter((f) =>
    f === field ? visible : current.includes(f),
  );
}

function toggleManual(
  current: ManualCreateField[],
  field: ManualCreateField,
  visible: boolean,
): ManualCreateField[] {
  return MANUAL_CREATE_FIELDS.filter((f) =>
    f === field ? visible : current.includes(f),
  );
}

/** Filter + normalize an untrusted persisted array against the canonical
 *  order. Non-array input (corrupt / legacy) falls back to the default. */
function normalizeQuick(raw: unknown): QuickCreateField[] {
  if (!Array.isArray(raw)) return [...DEFAULT_QUICK_CREATE_FIELDS];
  return QUICK_CREATE_FIELDS.filter((f) => raw.includes(f));
}

function normalizeManual(raw: unknown): ManualCreateField[] {
  if (!Array.isArray(raw)) return [...DEFAULT_MANUAL_CREATE_FIELDS];
  return MANUAL_CREATE_FIELDS.filter((f) => raw.includes(f));
}

/** Serialize file writes so a burst of toggles can't interleave. */
let persistChain: Promise<void> = Promise.resolve();

function settingsFile(wsId: string): File {
  return new File(Paths.document, `multica-issue-create-settings-${wsId}.json`);
}

function persist(wsId: string, settings: WorkspaceIssueCreateSettings): void {
  persistChain = persistChain
    .then(() => {
      settingsFile(wsId).write(JSON.stringify(settings));
    })
    .catch(() => {
      // Persistence is best-effort; a failed write must not break toggles.
    });
}

export const useIssueCreateSettingsStore = create<IssueCreateSettingsState>(
  (set) => ({
    byWorkspace: {},
    hydrated: {},

    hydrate: async (wsId) => {
      // Mark hydrated up front so concurrent mounts dedupe the read.
      set((s) => {
        if (s.hydrated[wsId]) return s;
        return { hydrated: { ...s.hydrated, [wsId]: true } };
      });
      let raw: { quick?: unknown; manual?: unknown } | null = null;
      try {
        const file = settingsFile(wsId);
        if (file.exists) {
          raw = JSON.parse(await file.text()) as { quick?: unknown; manual?: unknown };
        }
      } catch {
        // Corrupt/unreadable settings are not worth crashing over.
        raw = null;
      }
      const normalized = raw
        ? {
            quick: normalizeQuick(raw.quick),
            manual: normalizeManual(raw.manual),
          }
        : defaultIssueCreateSettings();
      set((s) => {
        // A toggle may have landed while the file read was in flight — never
        // clobber a value the user already set this session.
        if (s.byWorkspace[wsId] !== undefined) return s;
        return {
          byWorkspace: { ...s.byWorkspace, [wsId]: normalized },
        };
      });
    },

    setQuickCreateFieldVisible: (wsId, field, visible) =>
      set((s) => {
        const current = s.byWorkspace[wsId] ?? defaultIssueCreateSettings();
        const next = { ...current, quick: toggleQuick(current.quick, field, visible) };
        persist(wsId, next);
        return { byWorkspace: { ...s.byWorkspace, [wsId]: next } };
      }),

    setManualCreateFieldVisible: (wsId, field, visible) =>
      set((s) => {
        const current = s.byWorkspace[wsId] ?? defaultIssueCreateSettings();
        const next = { ...current, manual: toggleManual(current.manual, field, visible) };
        persist(wsId, next);
        return { byWorkspace: { ...s.byWorkspace, [wsId]: next } };
      }),
  }),
);

/**
 * Read the current workspace's issue-create settings, hydrating the store
 * once on first read. Returns stable defaults until the file resolves.
 * `byWorkspace[wsId]` is replaced only when that workspace's settings
 * change, so the selector below avoids the fresh-array re-render trap.
 */
export function useIssueCreateSettings(
  wsId: string | null,
): WorkspaceIssueCreateSettings {
  const settings = useIssueCreateSettingsStore((s) =>
    wsId ? s.byWorkspace[wsId] : undefined,
  );
  const hydrate = useIssueCreateSettingsStore((s) => s.hydrate);
  useEffect(() => {
    if (wsId) void hydrate(wsId);
  }, [wsId, hydrate]);
  return settings ?? defaultIssueCreateSettings();
}
