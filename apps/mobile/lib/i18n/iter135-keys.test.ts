import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Both locales describe the local-directory resource sheet.
describe("iteration 135 i18n", () => {
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
    // Local-directory resource sheet.
    "resource.kindRepository": "仓库",
    "resource.kindLocalDirectory": "本地目录",
    "resource.localPath": "目录绝对路径",
    "resource.localPathPlaceholder": "/home/you/code/repo",
    "resource.localRuntime": "运行时所在机器",
    "resource.localRuntimeEmpty": "工作区还没有可用的运行时。",
    "resource.localAlreadyAttached": "已挂载",
    "resource.modeTitle": "task 如何使用这个文件夹？",
    "resource.modeDescription": "这决定了你如何拿到智能体的工作成果，以及这个文件夹上的 task 能否同时运行。",
    "resource.modeInPlaceTitle": "直接修改这个文件夹",
    "resource.modeInPlaceDescription": "一次只跑一条 task。智能体的改动会直接出现在你的工作区里，你可以接着改。",
    "resource.modeWorktreeTitle": "并行隔离运行",
    "resource.modeWorktreeDescription": "task 可以同时跑，互不干扰，也不碰你的工作区。每条 task 的结果是这个仓库里的一个 agent/… 分支，由你审查后合并。",
    "resource.modeBadgeWorktree": "并行",
    "resource.modeBadgeInPlace": "原地",
    "resource.modeEdit": "修改执行方式",
    "resource.modeSave": "保存",
    "resource.modeUpdated": "已更新执行方式",
    "resource.attachLocalDirectory": "添加本地目录",
  };

  it("resolves every new key in both locales, with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, key).not.toBe(key);
      expect(en.length, key).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), key).toBe(zh);
      mod.setLocale("en");
    }
  });
});
