import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Iteration-46 batch-action i18n (extended in iteration-66 with success copy
// and the agent/squad assignment run-confirm). Same contract as
// subscription-keys.test.ts: every key resolves in BOTH locales and the zh
// value is actually translated.
describe("batch action i18n", () => {
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
    "batch.selected": "已选 {{count}} 项",
    "batch.exit": "完成",
    "batch.status": "状态",
    "batch.priority": "优先级",
    "batch.assignee": "负责人",
    "batch.delete": "删除",
    "batch.pickAssignee": "选择负责人…",
    "batch.clearAssignee": "清除负责人",
    "batch.pickAssigneeTitle": "将选中的问题指派给…",
    "batch.deleteTitle": "删除 {{count}} 个问题？",
    "batch.deleteMessage": "将永久删除选中的问题，且无法撤销。",
    "batch.updateFailedTitle": "更新失败",
    "batch.updateFailedBody": "无法更新选中的问题，请重试。",
    "batch.deleteFailedTitle": "删除失败",
    "batch.deleteFailedBody": "无法删除选中的问题，请重试。",
    // Iteration-66 additions: success copy + run-confirm for agent/squad assign.
    "batch.updateSuccess": "已更新 {{count}} 项",
    "batch.deleteSuccess": "已删除 {{count}} 项",
    "batch.selectAll": "全选",
    "batch.clearSelection": "清空",
    "batch.confirmAssignTitle": "确认指派？",
    "batch.confirmAssignOne": "将这个任务指派给 {{name}}；符合运行条件时会立即开始处理。",
    "batch.confirmAssignBatch": "将 {{count}} 个任务指派给 {{name}}；符合运行条件时会立即开始处理。",
    "batch.handoffNote": "交接说明（可选）",
    "batch.handoffPlaceholder": "交代一句——范围、重点、或别碰什么……",
    "batch.confirmAssign": "确认指派",
    "batch.dontStart": "暂不开始",
    "batch.assignFailedTitle": "指派失败",
    "batch.assignFailedBody": "无法指派选中的问题，请重试。",
  };

  it("resolves every batch key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });
});