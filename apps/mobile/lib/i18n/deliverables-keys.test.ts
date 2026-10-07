import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * Iteration 208's deliverables copy (MYS-1992 / MUL-7649).
 *
 * Both locales are pinned to web's own wording rather than invented here: the
 * same count label must not read differently on the two clients, and the zh
 * half is the load-bearing one — 「产物」 is web's translation of the
 * `Deliverables` section (`packages/views/locales/zh-Hans/issues.json`), and a
 * zh bundle defaulting to the raw id would leave a Chinese reader with
 * `deliverables.sectionTitle` in the issue header.
 *
 * Same contract as every other keys test: each key resolves in BOTH locales,
 * the en value is the real string (not the id fallback), and the zh value is
 * the exact copy.
 */
describe("deliverables i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("./index");
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH_SPOT: Record<string, string> = {
    "deliverables.sectionTitle": "产物",
    "deliverables.viewAll": "查看全部 {{count}} 个产物",
    "deliverables.overviewTitle": "{{identifier}} 的产物",
    "deliverables.overviewEmpty": "没有这类产物。",
    "deliverables.overviewClose": "关闭",
    "deliverables.filterAll": "全部",
    "deliverables.filterImage": "图片",
    "deliverables.filterDocument": "文档",
    "deliverables.filterVideo": "视频",
    "deliverables.filterMisc": "其他",
  };

  const EN_SPOT: Record<string, string> = {
    "deliverables.sectionTitle": "Deliverables",
    "deliverables.overviewEmpty": "No deliverables of this type.",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, `${key} missing from en`).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), `${key} zh copy drifted`).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("pins the two strings a reader sees before any interaction", () => {
    // The section header and the empty-state sentence are reachable without the
    // sheet ever being opened, so a wrong word here is the whole feature's
    // visible surface.
    for (const [key, en] of Object.entries(EN_SPOT)) {
      expect(mod.translate(key)).toBe(en);
    }
  });

  it("keeps the four category chips mutually distinct", () => {
    // The chips are a partition the reader picks from: two chips reading the
    // same word would make one of the buckets unreachable. Checked per locale,
    // because a translation pass can collapse a distinction the en bundle keeps.
    const chips = [
      "deliverables.filterImage",
      "deliverables.filterDocument",
      "deliverables.filterVideo",
      "deliverables.filterMisc",
    ];
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      const labels = chips.map((key) => mod.translate(key));
      expect(new Set(labels).size, `${locale} chips: ${labels.join(" / ")}`).toBe(
        chips.length,
      );
    }
    // 图片 is the images chip — web's noun for that bucket.
    mod.setLocale("zh");
    expect(mod.translate("deliverables.filterImage")).toBe("图片");
  });

  it("interpolates every placeholder the call sites pass", () => {
    mod.setLocale("zh");
    expect(mod.translate("deliverables.viewAll", { count: 7 })).toBe(
      "查看全部 7 个产物",
    );
    expect(mod.translate("deliverables.overviewTitle", { identifier: "MYS-568" })).toBe(
      "MYS-568 的产物",
    );
    mod.setLocale("en");
    expect(mod.translate("deliverables.nameWithVersion", { name: "report.md", version: 2 })).toBe(
      "report.md, version 2",
    );
    expect(mod.translate("deliverables.versionOf", { version: 2, total: 3 })).toBe(
      "v2 of 3",
    );
    expect(mod.translate("deliverables.groupCommentBy", { name: "Lambda" })).toBe(
      "Comment by Lambda",
    );
    expect(mod.translate("deliverables.overviewSummary", { count: 3 })).toBe(
      "3 deliverables",
    );
  });

  it("leaves no placeholder uninterpolated", () => {
    // A key whose `{{…}}` never gets substituted renders braces on screen. The
    // call sites and the params here are the full set, so a new placeholder
    // added without a matching param fails.
    const params: Record<string, Record<string, string | number>> = {
      "deliverables.viewAll": { count: 1 },
      "deliverables.nameWithVersion": { name: "a.md", version: 1 },
      "deliverables.versionLabel": { version: 1, total: 2 },
      "deliverables.versionOf": { version: 1, total: 2 },
      "deliverables.versionShort": { version: 1 },
      "deliverables.overviewTitle": { identifier: "MYS-1" },
      "deliverables.overviewSummary": { count: 1 },
      "deliverables.overviewSummaryWithSize": { count: 1, size: "1 KB" },
      "deliverables.groupCommentBy": { name: "A" },
    };
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      for (const [key, values] of Object.entries(params)) {
        expect(mod.translate(key, values), `${key} in ${locale}`).not.toContain("{{");
      }
    }
  });
});
