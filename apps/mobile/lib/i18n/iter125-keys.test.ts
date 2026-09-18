import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 125 — issue-list pagination footer, the chat
// composer's project-context row, and the execution-transcript filter/sort/copy
// controls. Same contract as iter119/…/iter124-keys.test.ts: every key resolves
// in BOTH locales and the zh value is a real translation, not the raw-id
// fallback.
describe("iteration 125 i18n", () => {
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
    // Pagination footer — web `ListLoadMoreFooter`'s three visible states.
    "issues.loadMoreFailed": "加载失败，点击重试",
    "issues.loadingMore": "加载中…",
    "issues.noMore": "没有更多任务了",
    // Chat composer project-context row (web `chat-input.tsx` pill).
    "chat.project.add": "添加项目",
    "chat.project.change": "更换项目",
    "chat.project.clear": "清除项目上下文",
    "chat.project.unsupported": "当前运行时不支持项目上下文",
    // Execution-transcript controls (web `agent-transcript-dialog.tsx`).
    "runs.transcript.filterAll": "全部",
    "runs.transcript.filterLabel": "类型过滤",
    "runs.transcript.sortOldest": "最早在前",
    "runs.transcript.sortNewest": "最新在前",
    "runs.transcript.copy": "复制",
    "runs.transcript.copied": "已复制",
    "runs.transcript.filterEmpty": "没有匹配的条目",
  };

  it("resolves every iteration-125 key in both locales", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), `zh mismatch: ${key}`).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("keeps the three footer states distinct", () => {
    // A collapsed wording would make "loading" and "no more" indistinguishable
    // to a screen reader and to the user.
    mod.setLocale("zh");
    const values = [
      mod.translate("issues.loadMoreFailed"),
      mod.translate("issues.loadingMore"),
      mod.translate("issues.noMore"),
    ];
    expect(new Set(values).size).toBe(3);
  });
});
