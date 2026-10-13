import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-72 inbox archive-view i18n (archived sub-view + row long-press
// menu). Same contract as chat-session-keys.test.ts: every key resolves in
// BOTH locales and the zh value is actually translated.
describe("inbox archive-view i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("./index");
  }

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH_SPOT: Record<string, string> = {
    "inbox.archivedTitle": "已归档",
    "inbox.archivedEmpty": "从主收件箱归档的条目会显示在这里。",
    "inbox.archivedLoadError": "无法加载已归档通知：",
    "inbox.menu.markRead": "标为已读",
    "inbox.menu.markUnread": "标为未读",
    "inbox.menu.unarchive": "取消归档",
  };

  // Iteration-247 additions: the archive's filter sheet and its paging footer.
  // Kept in a second map so a failure says which half of the view lost its
  // wording.
  const ZH_FILTERS_AND_PAGING: Record<string, string> = {
    "inbox.archivedFilterEmpty": "没有符合筛选条件的已归档通知",
    "inbox.archivedFilters": "筛选已归档通知",
    "inbox.archivedFiltersActive": "{{count}} 个筛选条件",
    "inbox.archivedFiltersClear": "清除筛选",
    "inbox.archivedFiltersFailed": "无法加载筛选项",
    "inbox.archivedFiltersFrom": "来自",
    "inbox.archivedFiltersNoOptions": "暂无可选项",
    "inbox.archivedFiltersPriority": "优先级",
    "inbox.archivedFiltersStatus": "状态",
    "inbox.archivedFiltersUnreadOnly": "只看未读",
    "inbox.archivedLoadMore": "加载更多",
    "inbox.archivedLoadMoreFailed": "加载失败，点击重试",
    "inbox.archivedLoadingMore": "加载中…",
    "inbox.archivedNoMore": "没有更多了",
    "inbox.archivedNotificationCount": "{{count}} 条",
  };

  it("resolves every inbox archive key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries({ ...ZH_SPOT, ...ZH_FILTERS_AND_PAGING })) {
      const enValue = mod.translate(key);
      expect(enValue, key).not.toBe(key);
      expect(enValue.length, key).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), key).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("en/zh key sets stay in parity (no key lives in only one locale)", () => {
    for (const key of Object.keys({ ...ZH_SPOT, ...ZH_FILTERS_AND_PAGING })) {
      mod.setLocale("en");
      const en = mod.translate(key);
      mod.setLocale("zh");
      const zh = mod.translate(key);
      expect(en === key && zh === key, key).toBe(false); // both locales know it
      expect(en, key).not.toBe(key);
      expect(zh, key).not.toBe(key);
    }
  });

  it("interpolates the count in the filter and count strings", () => {
    // These reach the user as a number, and an un-substituted `{{count}}` is
    // the kind of thing that only shows up on a device. Checked in both
    // locales because the placeholder is the same while the sentence is not.
    for (const locale of ["en", "zh"] as const) {
      mod.setLocale(locale);
      expect(mod.translate("inbox.archivedFiltersActive", { count: 3 })).toContain("3");
      expect(mod.translate("inbox.archivedNotificationCount", { count: 816 })).toContain(
        "816",
      );
      expect(mod.translate("inbox.archivedFiltersActive", { count: 3 })).not.toContain(
        "{{",
      );
    }
  });
});