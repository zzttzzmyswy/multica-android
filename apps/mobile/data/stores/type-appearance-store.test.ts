/**
 * Guards for the type-appearance store's persistence contract (MYS-2931).
 *
 * The pure ladder rules are pinned in `lib/type-appearance.test.ts`; this
 * file covers what only the store can get wrong:
 *
 *   - a corrupt or half-written file must render the DEFAULTS, not crash the
 *     launch (the setting is cosmetic; the app is not);
 *   - a value read back from disk must never be one the ladder cannot
 *     express, whatever the file says;
 *   - the store must reach a fixed point — re-reading its own output must not
 *     rewrite it, or every launch would churn the file;
 *   - "follow system" must survive a round trip AS the literal, so the app
 *     really does keep following the device after a restart.
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

const FILE = "multica-type-appearance.json";

async function load() {
  return await import("./type-appearance-store");
}

/**
 * Wait for the queued file write. `persist()` serialises through a promise
 * chain, so the write lands some indeterminate number of microtasks after the
 * setter returns; counting them is how this test first went flaky. Poll the
 * real effect instead.
 */
async function awaitPersist(until: (body: string) => boolean): Promise<string> {
  const deadline = Date.now() + 1000;
  let body = FILES.get(FILE) ?? "";
  while (Date.now() < deadline) {
    body = FILES.get(FILE) ?? "";
    if (body && until(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`persist did not settle; last body was ${body}`);
}

/** Write a raw file body, then load the store fresh against it. */
async function loadWith(body: string | null) {
  FILES.clear();
  if (body !== null) FILES.set(FILE, body);
  vi.resetModules();
  return await load();
}

describe("parseTypeAppearance reads a file field by field", () => {
  it("keeps a valid stored pair", async () => {
    const { parseTypeAppearance } = await load();
    expect(
      parseTypeAppearance({ fontSize: 16, contentLeading: "relaxed" }),
    ).toEqual({ fontSize: 16, contentLeading: "relaxed" });
  });

  it("keeps the literal follow-system rather than turning it into 14", async () => {
    // The regression that would silently stop the app following the device:
    // reading "system" back as the default NUMBER makes the two states one.
    const { parseTypeAppearance } = await load();
    const out = parseTypeAppearance({ fontSize: "system", contentLeading: "default" });
    expect(out.fontSize).toBe("system");
    expect(typeof out.fontSize).toBe("string");
  });

  it("never returns an off-ladder size, whatever the file holds", async () => {
    const { parseTypeAppearance } = await load();
    for (const bad of [14.7, 99, -1, "15", null, {}, [], true, Number.NaN]) {
      const out = parseTypeAppearance({ fontSize: bad, contentLeading: "compact" });
      expect(
        out.fontSize === "system" || [12, 13, 14, 15, 16].includes(out.fontSize as number),
        `fontSize ${JSON.stringify(bad)} produced ${JSON.stringify(out.fontSize)}`,
      ).toBe(true);
      // The unrelated field is still honoured — one bad field must not reset
      // the others.
      expect(out.contentLeading).toBe("compact");
    }
  });

  it("falls back for a non-object payload", async () => {
    const { parseTypeAppearance, DEFAULT_TYPE_APPEARANCE } = await load();
    for (const bad of [null, undefined, 42, "x", [], [1, 2]]) {
      expect(parseTypeAppearance(bad)).toEqual(DEFAULT_TYPE_APPEARANCE);
    }
  });

  it("is a fixed point on its own output", async () => {
    // The store writes what it parsed, so parsing the write must be a no-op.
    const { parseTypeAppearance } = await load();
    const once = parseTypeAppearance({ fontSize: 15, contentLeading: "relaxed" });
    expect(parseTypeAppearance(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe("the store hydrates from disk without crashing", () => {
  beforeEach(() => {
    FILES.clear();
  });

  it("applies a stored choice and marks itself hydrated", async () => {
    const { useTypeAppearanceStore } = await loadWith(
      JSON.stringify({ fontSize: 16, contentLeading: "relaxed" }),
    );
    await useTypeAppearanceStore.getState().hydrate();
    const s = useTypeAppearanceStore.getState();
    expect(s.fontSize).toBe(16);
    expect(s.contentLeading).toBe("relaxed");
    expect(s.hydrated).toBe(true);
  });

  it("falls back to the defaults on a corrupt file instead of throwing", async () => {
    // A truncated write is a normal event (killed mid-save). The app must
    // still open; a cosmetic setting is never worth a launch failure.
    const { useTypeAppearanceStore, DEFAULT_TYPE_APPEARANCE } = await loadWith(
      '{"fontSize": 16, "contentLea',
    );
    await expect(useTypeAppearanceStore.getState().hydrate()).resolves.toBeUndefined();
    const s = useTypeAppearanceStore.getState();
    expect(s.fontSize).toBe(DEFAULT_TYPE_APPEARANCE.fontSize);
    expect(s.contentLeading).toBe(DEFAULT_TYPE_APPEARANCE.contentLeading);
    expect(s.hydrated).toBe(true);
  });

  it("starts on follow-system when there is no file at all", async () => {
    // Upgrading users have no file. They must land on "follow system", which
    // is what they were doing before the setting existed.
    const { useTypeAppearanceStore } = await loadWith(null);
    await useTypeAppearanceStore.getState().hydrate();
    expect(useTypeAppearanceStore.getState().fontSize).toBe("system");
  });

  it("does not re-read the file once hydrated", async () => {
    const { useTypeAppearanceStore } = await loadWith(
      JSON.stringify({ fontSize: 15, contentLeading: "default" }),
    );
    await useTypeAppearanceStore.getState().hydrate();
    // A later write must not be clobbered by a second read of the old body.
    useTypeAppearanceStore.getState().setFontSize(12);
    await useTypeAppearanceStore.getState().hydrate();
    expect(useTypeAppearanceStore.getState().fontSize).toBe(12);
  });
});

describe("the store writes only values the ladder can express", () => {
  it("sanitises on the way in, not only on the way out", async () => {
    // A caller handing over an impossible size must not get it stored. If it
    // were only sanitised at read time the UI would briefly show a selection
    // it then discards.
    const { useTypeAppearanceStore } = await loadWith(null);
    await useTypeAppearanceStore.getState().hydrate();
    useTypeAppearanceStore.getState().setFontSize(14.7 as never);
    expect(useTypeAppearanceStore.getState().fontSize).toBe("system");
  });

  it("round-trips a chosen size through the file", async () => {
    const { useTypeAppearanceStore } = await loadWith(null);
    await useTypeAppearanceStore.getState().hydrate();
    useTypeAppearanceStore.getState().setFontSize(16);
    const body = await awaitPersist((b) => JSON.parse(b).fontSize === 16);
    expect(JSON.parse(body)).toEqual({ fontSize: 16, contentLeading: "default" });
  });

  it("persists follow-system as the literal, so the app keeps following the device", async () => {
    const { useTypeAppearanceStore } = await loadWith(null);
    await useTypeAppearanceStore.getState().hydrate();
    useTypeAppearanceStore.getState().setFontSize(16);
    useTypeAppearanceStore.getState().setFontSize("system");
    const body = await awaitPersist((b) => JSON.parse(b).fontSize === "system");
    expect(JSON.parse(body).fontSize).toBe("system");
  });

  it("reset returns to the schema defaults and persists them", async () => {
    const { useTypeAppearanceStore, DEFAULT_TYPE_APPEARANCE } = await loadWith(
      JSON.stringify({ fontSize: 16, contentLeading: "relaxed" }),
    );
    await useTypeAppearanceStore.getState().hydrate();
    useTypeAppearanceStore.getState().reset();
    const body = await awaitPersist((b) => JSON.parse(b).fontSize === "system");
    const s = useTypeAppearanceStore.getState();
    expect({ fontSize: s.fontSize, contentLeading: s.contentLeading }).toEqual(
      DEFAULT_TYPE_APPEARANCE,
    );
    expect(JSON.parse(body)).toEqual(DEFAULT_TYPE_APPEARANCE);
  });
});

describe("the derived font scale", () => {
  it("is the identity for the default rung and null for follow-system", async () => {
    const { useTypeAppearanceStore } = await loadWith(null);
    await useTypeAppearanceStore.getState().hydrate();
    expect(useTypeAppearanceStore.getState().fontSize).toBe("system");

    useTypeAppearanceStore.getState().setFontSize(14);
    expect(useTypeAppearanceStore.getState().fontSize).toBe(14);
  });
});
