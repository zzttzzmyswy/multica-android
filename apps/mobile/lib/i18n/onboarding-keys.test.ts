import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-55 onboarding + create-workspace i18n. Same contract as
// invite-keys.test.ts: every key resolves in BOTH locales and the zh values
// are real translations.
async function loadI18n() {
  return await import("./index");
}

describe("onboarding i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH_SPOT: Record<string, string> = {
    "onboarding.welcome.heading": "快速开始",
    "onboarding.welcome.start": "开始引导",
    "onboarding.welcome.skip": "我已有工作区，跳过引导",
    "onboarding.aboutYou.title": "怎么称呼你？",
    "onboarding.aboutYou.placeholder": "你的显示名称",
    "onboarding.aboutYou.skip": "先跳过",
    "onboarding.aboutYou.continue": "继续",
    "onboarding.aboutYou.saveError": "保存名称失败",
    "onboarding.workspace.title": "创建你的工作区",
    "onboarding.workspace.nameLabel": "工作区名称",
    "onboarding.workspace.namePlaceholder": "例如：Acme 公司",
    "onboarding.workspace.nameRequired": "请输入工作区名称。",
    "onboarding.workspace.slugLabel": "URL slug",
    "onboarding.workspace.slugPlaceholder": "例如：acme-inc",
    "onboarding.workspace.slugHint": "根据名称自动生成，可手动修改。",
    "onboarding.workspace.slugRequired": "请输入 slug。",
    "onboarding.workspace.slugInvalid": "slug 只能包含小写字母、数字和连字符（例如 acme-inc）。",
    "onboarding.workspace.slugConflict": "该 slug 已被占用，请换一个。",
    "onboarding.workspace.descriptionLabel": "描述（可选）",
    "onboarding.workspace.descriptionPlaceholder": "这个工作区是用来做什么的？",
    "onboarding.workspace.create": "创建工作区",
    "onboarding.workspace.creating": "创建中…",
    "onboarding.workspace.createFailed": "创建工作区失败，请重试",
    "onboarding.workspace.skipExisting": "跳过，使用已有工作区",
    "onboarding.runtime.title": "连接运行时（可选）",
    "onboarding.runtime.lede": "运行 agents 需要一台电脑作为运行环境。",
    "onboarding.runtime.step1": "在电脑上安装 Multica CLI。",
    "onboarding.runtime.step2": "运行 multica daemon 并登录。",
    "onboarding.runtime.step3": "你的电脑会出现在这里，并能为该工作区运行 agents。",
    "onboarding.runtime.later": "之后随时可以在工作区设置中连接运行时。",
    "onboarding.runtime.done": "完成并进入工作区",
    "onboarding.back": "返回",
    "onboarding.bannerTitle": "完成账号设置",
    "onboarding.bannerAction": "开始引导",
    "workspace.createWorkspace": "创建工作区",
    "workspace.createNew": "创建新工作区",
    "workspace.emptyHint": "你需要先有一个工作区才能开始。",
  };

  it("resolves every onboarding key in both locales", () => {
    for (const key of Object.keys(ZH_SPOT)) {
      expect(mod.translate(key, {})).toBeTruthy();
      expect(mod.translate(key, {})).not.toBe(key);
    }
  });

  it("has real zh translations (spot values)", () => {
    mod.setLocale("zh");
    for (const [key, value] of Object.entries(ZH_SPOT)) {
      expect(mod.translate(key, {})).toBe(value);
    }
  });
});