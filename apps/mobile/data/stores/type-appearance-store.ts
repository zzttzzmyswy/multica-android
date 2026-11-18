/**
 * Type appearance store — the single source of truth for the interface font
 * size and the content line spacing (MYS-2931).
 *
 * Persisted to a per-DEVICE JSON file through `expo-file-system`, the same
 * best-effort pattern as `comment-collapse-store.ts` and
 * `issue-workbench-layout-store.ts`. No new dependency.
 *
 * Device-scoped, not workspace-scoped, and that is deliberate: web's
 * appearance store is device-scoped too (`scope="device"` on its
 * SettingsTab, and `useAppearanceStore` persists under one localStorage key
 * with no workspace dimension). Reading comfort belongs to the phone in the
 * hand, not to a workspace — a user who needs 16pt on a small screen needs it
 * in every workspace, and re-picking it per workspace would be a bug.
 *
 * The store holds the RAW persisted value and never a derived metric: what
 * is stored is exactly what `sanitizeFontSize` returned, so nothing on disk
 * can be a size the ladder has no rung for (see `lib/type-appearance.ts`).
 *
 * Hydration is asynchronous (file I/O), so there is a window on cold start
 * where the last-known choice has not been read yet. It resolves to
 * "follow system", which is both the schema default and what the app did
 * before this setting existed — so the window shows the un-customised app
 * rather than a wrong choice.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { Paths, File } from "expo-file-system";
import {
  DEFAULT_CONTENT_LEADING,
  DEFAULT_FONT_SIZE_CHOICE,
  fontScaleFor,
  sanitizeContentLeading,
  sanitizeFontSize,
  type ContentLeading,
  type FontSizeChoice,
} from "@/lib/type-appearance";

export interface TypeAppearance {
  fontSize: FontSizeChoice;
  contentLeading: ContentLeading;
}

export const DEFAULT_TYPE_APPEARANCE: TypeAppearance = {
  fontSize: DEFAULT_FONT_SIZE_CHOICE,
  contentLeading: DEFAULT_CONTENT_LEADING,
};

/**
 * Read whatever is on disk into a valid `TypeAppearance`, field by field.
 * Exported for the tests, which is where the "corrupt file must not crash or
 * leak an off-ladder value" contract is pinned — a feature file that fails
 * to parse is a normal event (an interrupted write, a downgrade), not an
 * exceptional one.
 */
export function parseTypeAppearance(raw: unknown): TypeAppearance {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    fontSize: sanitizeFontSize(source.fontSize),
    contentLeading: sanitizeContentLeading(source.contentLeading),
  };
}

/** Serialize file writes so a burst of slider moves cannot interleave. */
let persistChain: Promise<void> = Promise.resolve();

function appearanceFile(): File {
  return new File(Paths.document, "multica-type-appearance.json");
}

function persist(state: TypeAppearance): void {
  persistChain = persistChain
    .then(() => {
      appearanceFile().write(JSON.stringify(state));
    })
    .catch(() => {
      // Persistence is best-effort: a failed write must not break the UI.
      // The in-memory value still applies for this session.
    });
}

interface TypeAppearanceState extends TypeAppearance {
  /** True once the on-disk value has been read (or found absent). */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setFontSize: (choice: FontSizeChoice) => void;
  setContentLeading: (leading: ContentLeading) => void;
  /** Back to "follow system" + default leading (web's `reset`). */
  reset: () => void;
}

export const useTypeAppearanceStore = create<TypeAppearanceState>((set, get) => ({
  ...DEFAULT_TYPE_APPEARANCE,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    let raw: unknown = null;
    try {
      const file = appearanceFile();
      if (file.exists) raw = JSON.parse(file.textSync()) as unknown;
    } catch {
      // A corrupt or unreadable file falls back to the defaults rather than
      // crashing the launch — the setting is cosmetic, the app is not.
      raw = null;
    }
    const parsed = parseTypeAppearance(raw);
    set((s) => ({
      // A change made while the read was in flight must survive it: the user
      // moved the slider before the file came back, and their choice is newer
      // than the file's. `hydrated` was false, so any difference here IS such
      // a change.
      fontSize: s.hydrated ? s.fontSize : pickNewer(s.fontSize, parsed.fontSize),
      contentLeading: s.hydrated
        ? s.contentLeading
        : pickNewerLeading(s.contentLeading, parsed.contentLeading),
      hydrated: true,
    }));
  },

  setFontSize: (choice) => {
    const next = sanitizeFontSize(choice);
    if (get().fontSize === next) return;
    set({ fontSize: next });
    persist({ ...snapshot(get()), fontSize: next });
  },

  setContentLeading: (leading) => {
    const next = sanitizeContentLeading(leading);
    if (get().contentLeading === next) return;
    set({ contentLeading: next });
    persist({ ...snapshot(get()), contentLeading: next });
  },

  reset: () => {
    set({ ...DEFAULT_TYPE_APPEARANCE });
    persist(DEFAULT_TYPE_APPEARANCE);
  },
}));

function snapshot(state: TypeAppearance): TypeAppearance {
  return { fontSize: state.fontSize, contentLeading: state.contentLeading };
}

/**
 * The in-memory value wins only when it differs from the schema default —
 * i.e. the user changed it during the read window. Otherwise the file wins.
 * Comparing against the default rather than "is it set" is what lets the
 * file still supply the value on a cold start (where memory holds the
 * default and the file holds the real choice).
 */
function pickNewer<T>(inMemory: T, fromFile: T): T {
  return inMemory === DEFAULT_TYPE_APPEARANCE.fontSize ? fromFile : inMemory;
}

function pickNewerLeading(
  inMemory: ContentLeading,
  fromFile: ContentLeading,
): ContentLeading {
  return inMemory === DEFAULT_TYPE_APPEARANCE.contentLeading ? fromFile : inMemory;
}

// Read the file once per process, at module load. Doing it here rather than
// in a component effect means the value is present before the first screen
// that uses it renders — a font size that arrives one frame late would make
// the whole app reflow on every launch.
void useTypeAppearanceStore.getState().hydrate();

/**
 * The stored choice plus the derived `--font-scale` factor, for the places
 * that cannot read a CSS variable (inline `style` objects and the native
 * markdown renderer).
 */
export function useFontScale(): number | null {
  return useTypeAppearanceStore((s) => fontScaleFor(s.fontSize));
}

/** Hydrate on mount — for tests and any surface mounted before module load settles. */
export function useHydrateTypeAppearance(): void {
  const hydrate = useTypeAppearanceStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
}
