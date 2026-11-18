/**
 * Guards for the persisted reduce-motion / high-contrast choice (MYS-2950).
 *
 * Sibling of `type-appearance-store.test.ts`, and it pins the same four
 * contracts through the same fake-file-system shape, plus the one rule that is
 * specific to these two fields: a corrupt or half-written file must fall back
 * to `false` **per field**, so a damaged `highContrast` cannot silently switch
 * the animation preference off with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const FILES = new Map<string, string>();

vi.mock("expo-file-system", () => {
  class FakeFile {
    private readonly path: string;
    constructor(_base: unknown, name: string) {
      this.path = name;
    }
    get exists() {
      return FILES.has(this.path);
    }
    textSync() {
      const value = FILES.get(this.path);
      if (value === undefined) throw new Error("ENOENT");
      return value;
    }
    write(text: string) {
      FILES.set(this.path, text);
    }
  }
  return { File: FakeFile, Paths: { document: "/documents" } };
});

const FILE = "multica-appearance-a11y.json";

async function load() {
  return await import("./appearance-a11y-store");
}

/** Poll the real effect — `persist()` serialises through a promise chain. */
async function awaitPersist(until: (body: string) => boolean): Promise<string> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const body = FILES.get(FILE) ?? "";
    if (body && until(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`persist did not settle; last body was ${FILES.get(FILE) ?? ""}`);
}

async function loadWith(body: string | null) {
  FILES.clear();
  if (body !== null) FILES.set(FILE, body);
  vi.resetModules();
  return await load();
}

beforeEach(() => {
  FILES.clear();
});

describe("parseAppearanceA11y reads a file field by field", () => {
  it("keeps a valid stored pair", async () => {
    const { parseAppearanceA11y } = await load();
    expect(parseAppearanceA11y({ reduceMotion: true, highContrast: true })).toEqual({
      reduceMotion: true,
      highContrast: true,
    });
  });

  it("falls back to false for anything that is not a boolean", async () => {
    // A persisted `"true"` (a string from an older payload), a `1`, a `null`:
    // none of them is what the toggle can render, and coercing with `Boolean`
    // would turn the string "false" into an enabled setting.
    const { parseAppearanceA11y } = await load();
    for (const bad of ["true", 1, null, undefined, {}, []]) {
      expect(
        parseAppearanceA11y({ reduceMotion: bad, highContrast: bad }),
        `value ${JSON.stringify(bad)} must not survive`,
      ).toEqual({ reduceMotion: false, highContrast: false });
    }
  });

  it("keeps one valid field when the other is corrupt", async () => {
    // The per-field contract: a damaged `highContrast` must not also clear a
    // deliberate `reduceMotion`. A reduce-motion choice is an accessibility
    // accommodation; losing it to an unrelated bad byte is a real harm.
    const { parseAppearanceA11y } = await load();
    expect(
      parseAppearanceA11y({ reduceMotion: true, highContrast: "yes" }),
    ).toEqual({ reduceMotion: true, highContrast: false });
  });

  it("survives a non-object payload without throwing", async () => {
    const { parseAppearanceA11y } = await load();
    for (const bad of [null, undefined, 42, "text", []]) {
      expect(parseAppearanceA11y(bad)).toEqual({
        reduceMotion: false,
        highContrast: false,
      });
    }
  });
});

describe("the store persists and hydrates", () => {
  it("starts from the defaults and hydrates an absent file to them", async () => {
    const { useAppearanceA11yStore } = await loadWith(null);
    await useAppearanceA11yStore.getState().hydrate();
    const state = useAppearanceA11yStore.getState();
    expect(state.reduceMotion).toBe(false);
    expect(state.highContrast).toBe(false);
    expect(state.hydrated).toBe(true);
  });

  it("reads the file on hydrate", async () => {
    const { useAppearanceA11yStore } = await loadWith(
      JSON.stringify({ reduceMotion: true, highContrast: false }),
    );
    await useAppearanceA11yStore.getState().hydrate();
    expect(useAppearanceA11yStore.getState().reduceMotion).toBe(true);
  });

  it("writes both fields when either is set", async () => {
    // The file is one object, so a partial write would drop the other field on
    // the next launch. Every setter must persist the whole pair.
    const { useAppearanceA11yStore } = await loadWith(null);
    await useAppearanceA11yStore.getState().hydrate();
    useAppearanceA11yStore.getState().setHighContrast(true);
    const body = await awaitPersist((raw) => JSON.parse(raw).highContrast === true);
    expect(JSON.parse(body)).toEqual({ reduceMotion: false, highContrast: true });
  });

  it("round-trips through its own output without churn", async () => {
    const { useAppearanceA11yStore } = await loadWith(
      JSON.stringify({ reduceMotion: true, highContrast: true }),
    );
    await useAppearanceA11yStore.getState().hydrate();
    const again = await loadWith(FILES.get(FILE) ?? null);
    await again.useAppearanceA11yStore.getState().hydrate();
    expect(again.useAppearanceA11yStore.getState().reduceMotion).toBe(true);
    expect(again.useAppearanceA11yStore.getState().highContrast).toBe(true);
  });

  it("does not rewrite the file when a setter is a no-op", async () => {
    // Toggling to the value already held must not churn storage — the switch
    // fires on every tap, including a re-tap of the current state.
    const { useAppearanceA11yStore } = await loadWith(
      JSON.stringify({ reduceMotion: true, highContrast: false }),
    );
    await useAppearanceA11yStore.getState().hydrate();
    const before = FILES.get(FILE);
    useAppearanceA11yStore.getState().setReduceMotion(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(FILES.get(FILE)).toBe(before);
  });

  it("matches the default when reset", async () => {
    const { useAppearanceA11yStore } = await loadWith(
      JSON.stringify({ reduceMotion: true, highContrast: true }),
    );
    await useAppearanceA11yStore.getState().hydrate();
    useAppearanceA11yStore.getState().reset();
    await awaitPersist((raw) => JSON.parse(raw).reduceMotion === false);
    expect(useAppearanceA11yStore.getState().reduceMotion).toBe(false);
    expect(useAppearanceA11yStore.getState().highContrast).toBe(false);
  });
});
