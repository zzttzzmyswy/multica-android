import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

import * as SecureStore from "expo-secure-store";
import { getLocales } from "expo-localization";

// Imported lazily inside describe so the mocks above are registered first.
async function loadI18n() {
  return await import("./index");
}
async function loadReact() {
  return await import("./react");
}

describe("i18n translate", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await loadI18n();
    mod.resetI18nForTests();
    // default to English for deterministic results
    mod.setLocale("en");
  });

  it("translates a known key to English by default", () => {
    expect(mod.translate("login.title")).toBe("Sign in to Multica");
  });

  it("returns the raw id for an unknown key", () => {
    expect(mod.translate("does.not.exist")).toBe("does.not.exist");
  });

  it("switching to zh returns Chinese", () => {
    mod.setLocale("zh");
    expect(mod.translate("login.title")).toBe("登录 Multica");
  });

  it("interpolates parameters into placeholders", () => {
    expect(mod.translate("verify.subtitle", { email: "a@b.c" })).toBe(
      "We sent a 6-digit code to a@b.c",
    );
    mod.setLocale("zh");
    expect(mod.translate("verify.subtitle", { email: "a@b.c" })).toBe(
      "我们已将 6 位验证码发送至 a@b.c",
    );
  });

  it("localizes bottom-nav tab labels", () => {
    expect(mod.translate("nav.inbox")).toBe("Inbox");
    expect(mod.translate("nav.myIssues")).toBe("My Issues");
    expect(mod.translate("nav.chat")).toBe("Chat");
    expect(mod.translate("nav.more")).toBe("More");

    mod.setLocale("zh");
    expect(mod.translate("nav.inbox")).toBe("收件箱");
    expect(mod.translate("nav.myIssues")).toBe("我的问题");
    expect(mod.translate("nav.chat")).toBe("聊天");
    expect(mod.translate("nav.more")).toBe("更多");
  });

  it("notifies locale-change subscribers", () => {
    const fn = vi.fn();
    const unsub = mod.subscribeLocale(fn);
    mod.setLocale("zh");
    expect(fn).toHaveBeenCalledTimes(1);
    unsub();
    mod.setLocale("en");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("localizes workspace selection, sign-out and empty-state strings", () => {
    expect(mod.translate("workspace.selectTitle")).toBe(
      "Select a workspace",
    );
    expect(mod.translate("workspace.signOut")).toBe("Sign out");
    expect(mod.translate("settings.signOutTitle")).toBe("Sign out");
    expect(mod.translate("myIssues.emptyAssigned")).toBe(
      "No issues assigned to you.",
    );
    expect(mod.translate("issues.emptyAll")).toBe(
      "No issues in this workspace.",
    );

    mod.setLocale("zh");
    expect(mod.translate("workspace.selectTitle")).toBe("选择工作区");
    expect(mod.translate("workspace.signOut")).toBe("退出登录");
    expect(mod.translate("settings.signOutTitle")).toBe("退出登录");
    expect(mod.translate("myIssues.emptyAssigned")).toBe(
      "没有指派给您的问题。",
    );
    expect(mod.translate("issues.emptyAll")).toBe("此工作区没有问题。");
  });

  it("interpolates the switch-workspace confirm message", () => {
    expect(mod.translate("switchWorkspace.message", { name: "Acme" })).toBe(
      'Switch to "Acme"?',
    );
    mod.setLocale("zh");
    expect(mod.translate("switchWorkspace.message", { name: "Acme" })).toBe(
      "切换到「Acme」？",
    );
  });
});

describe("initI18n device-language resolution", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await loadI18n();
    mod.resetI18nForTests();
  });

  it("uses the device zh language when no override is saved", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null as never);
    vi.mocked(getLocales).mockReturnValue([
      { languageCode: "zh" } as never,
    ]);
    const locale = await mod.initI18n();
    expect(locale).toBe("zh");
  });

  it("uses a persisted zh override regardless of device language", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("zh" as never);
    vi.mocked(getLocales).mockReturnValue([
      { languageCode: "en" } as never,
    ]);
    const locale = await mod.initI18n();
    expect(locale).toBe("zh");
  });

  it("falls back to en for unsupported device languages", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null as never);
    vi.mocked(getLocales).mockReturnValue([
      { languageCode: "fr" } as never,
    ]);
    const locale = await mod.initI18n();
    expect(locale).toBe("en");
  });

  it("localizes deep-UI composer and profile placeholders", () => {
    expect(mod.translate("comment.placeholder")).toBe("Add a comment…");
    expect(mod.translate("chat.placeholder")).toBe("Message…");
    expect(mod.translate("chat.agentWorking")).toBe("Agent is working…");
    mod.setLocale("zh");
    expect(mod.translate("comment.placeholder")).toBe("添加评论…");
    expect(mod.translate("chat.placeholder")).toBe("输入消息…");
    expect(mod.translate("chat.agentWorking")).toBe("Agent 正在执行…");
    expect(mod.translate("settings.namePlaceholder")).toBe("您的名称");
  });
});