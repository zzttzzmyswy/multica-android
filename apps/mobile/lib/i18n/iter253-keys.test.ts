import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-253 in-row project cells (MYS-2202).
//
// Same contract as every keys test: the key resolves in BOTH locales, the en
// value is the real string (not the raw-id fallback), and the zh value is the
// exact Chinese copy.
//
// The two lead states are the ones worth pinning by hand. `leadNone` is web's
// own `lead.no_lead` verbatim — 「无负责人」 — so a phone and a desktop name the
// same state the same way. `leadPending` has no web counterpart: web never has
// to render it, because the lead picker there is a popover that only exists
// after the page has rendered, while a phone list paints its rows while the
// member/agent directories are still in flight. It must therefore read as an
// unfinished read ("尚未加载") and never as an absence — collapsing the two
// would put the cell back to asserting 「无负责人」 over a project that has a
// lead, which is the defect the cell exists to avoid.
describe("projects in-row cell i18n", () => {
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
    "projects.leadNone": "无负责人",
    "projects.leadPending": "负责人尚未加载",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("names the empty lead exactly as web does", () => {
    // Verbatim from packages/views/locales/{en,zh-Hans}/projects.json
    // (`lead.no_lead`). Parity with the other client is the point: one state,
    // one name.
    expect(mod.translate("projects.leadNone")).toBe("No lead");
    mod.setLocale("zh");
    expect(mod.translate("projects.leadNone")).toBe("无负责人");
  });

  it("keeps the two lead states apart in both languages", () => {
    // A locale rewrite that collapsed them would put the cell back to claiming
    // an absence it never read.
    const enNone = mod.translate("projects.leadNone");
    const enPending = mod.translate("projects.leadPending");
    expect(enPending).not.toBe(enNone);
    mod.setLocale("zh");
    expect(mod.translate("projects.leadPending")).not.toBe(
      mod.translate("projects.leadNone"),
    );
  });

  it("phrases the pending state as an unfinished read, not an absence", () => {
    // "尚未加载" says the data has not arrived; "无负责人" would say it does not
    // exist. The cell renders nothing at all in this state, so this string is
    // the fallback for a translator reading the bundle — it must still describe
    // the right thing.
    mod.setLocale("zh");
    const pending = mod.translate("projects.leadPending");
    expect(pending).toContain("加载");
    expect(pending).not.toContain("无");
  });
});
