import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-41 download-manager i18n. Same contract as
// about-keys.test.ts: every key resolves in BOTH locales and the zh value is
// actually translated (not the en text echoed back).
describe("downloads i18n", () => {
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
    "nav.downloads": "下载",
    "screen.downloads": "下载",
    "downloads.tab.active": "进行中",
    "downloads.tab.finished": "已完成",
    "downloads.emptyActive": "暂无进行中的下载",
    "downloads.emptyFinished": "暂无下载记录",
    "downloads.source.chat": "聊天",
    "downloads.source.issue": "问题",
    "downloads.source.other": "其他",
    "downloads.cancel": "取消",
    "downloads.retry": "重试",
    "downloads.delete": "删除",
    "downloads.open": "打开",
    "downloads.cancelled": "已取消",
    "downloads.failed": "失败",
    "downloads.completed": "已完成",
    "downloads.downloading": "下载中",
    "downloads.clearFinished": "清空已完成",
    "downloads.deleteConfirmTitle": "删除这条下载记录？",
    "downloads.deleteConfirmMessage": "设备上对应的文件也会被删除。",
    "downloads.error.interrupted": "下载因应用重启而中断，可重试。",
    "chat.agentUnknown": "未知 agent",
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

  it("source label keys feed the download-manager source renderer", () => {
    mod.setLocale("zh");
    expect(mod.translate("downloads.source.chat")).toBe("聊天");
    expect(mod.translate("downloads.source.issue")).toBe("问题");
    expect(mod.translate("downloads.source.other")).toBe("其他");
  });
});