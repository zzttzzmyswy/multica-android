import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * Cloud runtime node timestamps must follow the APP language, not the device
 * language (iteration 284, MYS-2580).
 *
 * `formatDateTime` used to build its formatter with `Intl.DateTimeFormat(
 * undefined, …)`. An undefined locale is not "the app's language" — it is
 * "whatever the phone is set to". The app language is a separate setting, so a
 * member reading the Chinese UI on an English phone saw "Nov 2, 09:30 AM"
 * between two Chinese labels. `lib/format-date.ts` documents this exact rule;
 * `lib/autopilot-format.ts` already complies.
 *
 * Two assertions per locale, deliberately redundant:
 *   1. Whole-string equality — pins the actual rendering, so "fixed" by
 *      deleting the formatter or by returning the raw ISO string still fails.
 *   2. The two locales must DISAGREE — without this, "fixing" the fallback by
 *      hardcoding one tag turns both cases green while reinstating the bug for
 *      every other language. Same negative gate as iteration 278's heatmap.
 *
 * The timestamp is fixed and TZ is pinned so the expected strings do not
 * depend on the machine running the suite: 09:30Z renders as 09:30 in UTC.
 */
const NODE_CREATED_AT = "2026-11-02T09:30:00Z";

async function loadI18n() {
  return await import("./i18n");
}

async function formatAt(appLocale: "en" | "zh") {
  const i18n = await loadI18n();
  i18n.setLocale(appLocale);
  const { formatCloudRuntimeNodeCreatedAt } = await import(
    "./cloud-runtime-format"
  );
  return formatCloudRuntimeNodeCreatedAt(NODE_CREATED_AT);
}

describe("cloud runtime node timestamp locale", () => {
  const savedTz = process.env.TZ;

  beforeEach(async () => {
    process.env.TZ = "UTC";
    const i18n = await loadI18n();
    i18n.resetI18nForTests();
  });

  // Restore rather than delete: a sibling suite may have set TZ deliberately.
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("renders the timestamp in Chinese when the app locale is zh", async () => {
    expect(await formatAt("zh")).toBe("11月2日 09:30");
  });

  it("renders the timestamp in English when the app locale is en", async () => {
    expect(await formatAt("en")).toBe("Nov 2, 09:30 AM");
  });

  it("produces different strings per locale, so neither is a hardcoded tag", async () => {
    const zh = await formatAt("zh");
    const en = await formatAt("en");
    expect(zh).not.toBe(en);
  });

  it("follows an explicit locale argument over the store's current locale", async () => {
    const i18n = await loadI18n();
    const { formatCloudRuntimeNodeCreatedAt } = await import(
      "./cloud-runtime-format"
    );
    i18n.setLocale("en");
    expect(formatCloudRuntimeNodeCreatedAt(NODE_CREATED_AT, "zh-CN")).toBe(
      "11月2日 09:30",
    );
  });

  it("returns null for an unparseable timestamp instead of throwing", async () => {
    const { formatCloudRuntimeNodeCreatedAt } = await import(
      "./cloud-runtime-format"
    );
    expect(formatCloudRuntimeNodeCreatedAt("not-a-date")).toBeNull();
  });
});
