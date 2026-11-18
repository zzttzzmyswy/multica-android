/**
 * Appearance accessibility store — the persisted 「减少动效」 / 「高对比度」
 * choice (MYS-2950).
 *
 * Sibling of `type-appearance-store.ts` and deliberately a SEPARATE file, for
 * one reason: that store is read by `lib/markdown/markdown-style.ts` on every
 * markdown block in the app, and adding two fields there would make every one
 * of those call sites re-render when someone flips a contrast switch. These two
 * fields are read in exactly three places — the root layout (to set the
 * variable/class and to feed the animation judgement), the settings screen, and
 * `useReducedMotion` — so they get their own subscription.
 *
 * Persisted to a per-DEVICE JSON file through `expo-file-system`, the same
 * best-effort pattern as `type-appearance-store.ts` and
 * `comment-collapse-store.ts`. Device-scoped for the same reason the type
 * choice is: a phone held by someone with vestibular sensitivity needs reduced
 * motion in every workspace, and re-picking it per workspace would be a bug.
 *
 * The stored values are the RAW user choices and never the resolved outcome.
 * That distinction is load-bearing: the effective "skip animation" answer is
 * `user || system` (see `lib/appearance-a11y.ts`), and if this store persisted
 * the union then a phone with the system setting on would write `true` to disk,
 * and the choice would stay stuck on after the person turned the system
 * setting off — a one-way door with no visible cause.
 */
import { create } from "zustand";
import { Paths, File } from "expo-file-system";

export interface AppearanceA11y {
  /** The person's own choice. The effective answer also ORs in the device. */
  reduceMotion: boolean;
  highContrast: boolean;
}

export const DEFAULT_APPEARANCE_A11Y: AppearanceA11y = {
  reduceMotion: false,
  highContrast: false,
};

/**
 * Read whatever is on disk into a valid pair, field by field.
 *
 * Exported because the "corrupt file must not crash the launch, and one bad
 * field must not take the other down" contract is what the tests pin — a
 * damaged file (interrupted write, a downgrade, a hand-edit) is a normal event
 * for a preference file, not an exceptional one.
 *
 * Only a real boolean survives. `Boolean(value)` would be wrong here in a way
 * that matters: the string `"false"` is truthy, so a file written by anything
 * that stringified its booleans would silently enable both settings.
 */
export function parseAppearanceA11y(raw: unknown): AppearanceA11y {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    reduceMotion:
      typeof source.reduceMotion === "boolean"
        ? source.reduceMotion
        : DEFAULT_APPEARANCE_A11Y.reduceMotion,
    highContrast:
      typeof source.highContrast === "boolean"
        ? source.highContrast
        : DEFAULT_APPEARANCE_A11Y.highContrast,
  };
}

/** Serialize file writes so two quick taps cannot interleave. */
let persistChain: Promise<void> = Promise.resolve();

function appearanceFile(): File {
  return new File(Paths.document, "multica-appearance-a11y.json");
}

function persist(state: AppearanceA11y): void {
  persistChain = persistChain
    .then(() => {
      appearanceFile().write(JSON.stringify(state));
    })
    .catch(() => {
      // Best-effort: a failed write must not break the UI. The in-memory
      // value still applies for this session.
    });
}

interface AppearanceA11yState extends AppearanceA11y {
  /** True once the on-disk value has been read (or found absent). */
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setReduceMotion: (value: boolean) => void;
  setHighContrast: (value: boolean) => void;
  /** Back to both-off, which is what a fresh install shows. */
  reset: () => void;
}

export const useAppearanceA11yStore = create<AppearanceA11yState>((set, get) => ({
  ...DEFAULT_APPEARANCE_A11Y,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    let raw: unknown = null;
    try {
      const file = appearanceFile();
      if (file.exists) raw = JSON.parse(file.textSync()) as unknown;
    } catch {
      // A corrupt or unreadable file falls back to the defaults rather than
      // crashing the launch — these are cosmetic-plus-accessibility settings,
      // and defaults are the un-customised app, not a wrong choice.
      raw = null;
    }
    const parsed = parseAppearanceA11y(raw);
    set((s) => ({
      // A change made while the read was in flight must survive it. A switch
      // is only ever turned ON by a person with intent, so an in-memory `true`
      // is newer than the file and wins; an in-memory `false` may just be the
      // default, so the file supplies the value. Comparing against the default
      // (rather than "was it set") is what lets the file still apply on a cold
      // start, where memory holds the default and the file holds the choice.
      reduceMotion: s.reduceMotion || parsed.reduceMotion,
      highContrast: s.highContrast || parsed.highContrast,
      hydrated: true,
    }));
  },

  setReduceMotion: (value) => {
    if (get().reduceMotion === value) return;
    set({ reduceMotion: value });
    persist({ ...snapshot(get()), reduceMotion: value });
  },

  setHighContrast: (value) => {
    if (get().highContrast === value) return;
    set({ highContrast: value });
    persist({ ...snapshot(get()), highContrast: value });
  },

  reset: () => {
    set({ ...DEFAULT_APPEARANCE_A11Y });
    persist(DEFAULT_APPEARANCE_A11Y);
  },
}));

function snapshot(state: AppearanceA11y): AppearanceA11y {
  return { reduceMotion: state.reduceMotion, highContrast: state.highContrast };
}

// Read the file once per process, at module load — the same reason
// `type-appearance-store.ts` does: the root layout sets the contrast class on
// its FIRST render, and a value that arrived one frame late would paint the
// whole app at normal contrast and then jump.
void useAppearanceA11yStore.getState().hydrate();
