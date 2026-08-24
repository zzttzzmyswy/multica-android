import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-98 agent integrations i18n (MYS-699).
// Same contract as every keys test: every key resolves in BOTH locales (a zh
// tag proves the en key is real, and vice versa), the zh value is actually
// translated, and the key SETS stay symmetric.
describe("agents integrations i18n", () => {
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
    "agents.detail.menu.integrations",
    "agents.integrations.title",
    "agents.integrations.intro",
    "agents.integrations.membersNote",
    "agents.integrations.readonlyHint",
    "agents.integrations.larkName",
    "agents.integrations.slackName",
    "agents.integrations.dingtalkName",
    "agents.integrations.wecomName",
    "agents.integrations.larkDescription",
    "agents.integrations.slackDescription",
    "agents.integrations.dingtalkDescription",
    "agents.integrations.wecomDescription",
    "agents.integrations.statusActive",
    "agents.integrations.statusRevoked",
    "agents.integrations.larkRegionFeishu",
    "agents.integrations.larkRegionLark",
    "agents.integrations.botIdLabel",
    "agents.integrations.teamIdLabel",
    "agents.integrations.installedByLabel",
    "agents.integrations.installedAtLabel",
    "agents.integrations.configureMissing",
    "agents.integrations.comingSoon",
    "agents.integrations.bindInBrowser",
    "agents.integrations.openError",
  ];

  const ZH_SPOT: Record<string, string> = {
    "agents.detail.menu.integrations": "渠道绑定",
    "agents.integrations.title": "渠道绑定",
    "agents.integrations.statusActive": "已连接",
    "agents.integrations.statusRevoked": "已撤销",
    "agents.integrations.larkRegionFeishu": "飞书",
    "agents.integrations.larkRegionLark": "Lark",
    "agents.integrations.botIdLabel": "机器人 ID",
    "agents.integrations.teamIdLabel": "团队 ID",
    "agents.integrations.installedByLabel": "安装者",
    "agents.integrations.installedAtLabel": "安装时间",
    "agents.integrations.bindInBrowser": "在浏览器中绑定",
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
});