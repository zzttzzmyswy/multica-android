import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-80 agent env bulk-edit i18n (MYS-578).
// Same contract as every keys test: every key resolves in BOTH locales (a zh
// tag proves the en key is real, and vice versa), the zh value is actually
// translated, and the key SETS stay symmetric.
describe("agents env bulk-edit i18n", () => {
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

  const KEYS = [
    "agents.env.bulkEditAction",
    "agents.env.rowEditAction",
    "agents.env.bulkPlaceholder",
    "agents.env.bulkPlaintextNotice",
    "agents.env.parseErrorMalformed",
    "agents.env.parseErrorDuplicate",
    "agents.env.bulkUnsupportedTitle",
    "agents.env.bulkUnsupportedMessage",
    "agents.env.emptyEditable",
  ];

  const ZH_SPOT: Record<string, string> = {
    "agents.env.bulkEditAction": "批量编辑",
    "agents.env.rowEditAction": "逐条编辑",
    "agents.env.bulkPlaintextNotice": "批量编辑时，值以明文显示。",
    "agents.env.parseErrorMalformed": "第 {{line}} 行不是 KEY=value 格式",
    "agents.env.bulkUnsupportedTitle": "无法批量编辑",
    "agents.env.emptyEditable": "尚未配置环境变量。新增一条即可在智能体启动时注入。",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const key of KEYS) {
      const en = mod.translate(key);
      expect(en).not.toBe(key); // en present (not the raw id fallback)
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      const zh = mod.translate(key);
      expect(zh.length).toBeGreaterThan(0);
      expect(zh).not.toBe(key);
      if (key in ZH_SPOT) {
        expect(zh).toBe(ZH_SPOT[key]);
      }
      mod.setLocale("en");
    }
  });

  it("en/zh key sets stay in parity (no key lives in only one locale)", () => {
    for (const key of KEYS) {
      mod.setLocale("en");
      expect(mod.translate(key)).not.toBe(key);
      mod.setLocale("zh");
      expect(mod.translate(key)).not.toBe(key);
    }
  });

  it("interpolates line/key into the parse-error messages in both locales", () => {
    mod.setLocale("en");
    expect(mod.translate("agents.env.parseErrorMalformed", { line: 4 })).toBe(
      "Line 4 isn't a KEY=value assignment",
    );
    expect(
      mod.translate("agents.env.parseErrorDuplicate", { line: 3, key: "FOO" }),
    ).toBe('Duplicate key "FOO" on line 3');
    expect(
      mod.translate("agents.env.bulkUnsupportedMessage", { key: "PEM" }),
    ).toBe('"PEM" can\'t be shown as text — edit it as a row');

    mod.setLocale("zh");
    expect(mod.translate("agents.env.parseErrorMalformed", { line: 4 })).toBe(
      "第 4 行不是 KEY=value 格式",
    );
    expect(
      mod.translate("agents.env.parseErrorDuplicate", { line: 3, key: "FOO" }),
    ).toBe('第 3 行的 key "FOO" 重复');
    expect(
      mod.translate("agents.env.bulkUnsupportedMessage", { key: "PEM" }),
    ).toBe('"PEM" 的值无法用文本表示，请改用逐条编辑修改');
  });
});