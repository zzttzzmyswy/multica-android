import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-24 autopilot create/delete/trigger i18n.
// The contract: every key resolves in BOTH locales (a zh tag proves the en
// key is real, and vice versa) and the zh value is actually translated.
describe("autopilot create/trigger i18n", () => {
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
    "autopilots.new.title": "新建自动化",
    "autopilots.new.agentRequired": "请选择执行本自动化的智能体",
    "autopilots.new.create": "创建",
    "autopilots.detail.delete": "删除自动化",
    "autopilots.detail.addTrigger": "添加触发器",
    "autopilots.trigger.kind": "触发器类型",
    "autopilots.trigger.timezone": "时区",
    "autopilots.trigger.rotateUrl": "旋转 Webhook URL",
    "autopilots.trigger.urlCopied": "Webhook URL 已复制",
    // Iteration-85 web alignment: event filters / subscribers / access.
    "autopilots.eventFilter.label": "事件过滤",
    "autopilots.eventFilter.hint": "只处理匹配这些事件的 webhook。留空则接受所有事件。",
    "autopilots.subscribers.sectionLabel": "订阅者",
    "autopilots.subscribers.add": "添加订阅者",
    "autopilots.subscribers.hint": "每次跑出来的任务默认订阅",
    "autopilots.detail.subscribers": "订阅者",
    "autopilots.detail.noSubscribers": "暂无订阅者",
    "autopilots.access.sectionLabel": "管理访问",
    "autopilots.access.add": "添加成员",
    "autopilots.access.empty": "还没有授权任何人。",
    "autopilots.access.ownerNote": "创建者和工作区管理员始终拥有访问权限。",
    "autopilots.access.failedTitle": "更新访问权限失败",
    "autopilots.deliveries.sectionTitle": "Webhook 投递",
    "autopilots.deliveries.empty": "暂无 Webhook 投递记录。向 Webhook URL 发送一次 POST 后会显示在这里。",
    "autopilots.deliveries.status.queued": "排队中",
    "autopilots.deliveries.replay": "重放",
    "autopilots.deliveries.replaying": "重放中…",
    "autopilots.deliveries.replayed": "已重放该投递",
    // Iteration-88 web alignment: edit mode / project / squad assignee.
    "autopilots.detail.edit": "编辑",
    "autopilots.detail.fieldProject": "项目",
    "autopilots.detail.noProject": "无项目",
    "autopilots.detail.projectUnavailable": "项目不可用",
    "autopilots.edit.title": "编辑自动化",
    "autopilots.edit.save": "保存",
    "autopilots.edit.failedTitle": "更新自动化失败",
    "autopilots.new.assignee": "执行对象",
    "autopilots.new.selectAssignee": "选择智能体或 Squad…",
    "autopilots.new.project": "项目",
    "autopilots.new.noProject": "无项目",
    "autopilots.new.selectProject": "选择项目…",
    "autopilots.assigneePicker.title": "选择智能体或 Squad",
    "autopilots.assigneePicker.empty": "当前工作区没有智能体或 Squad",
    "autopilots.projectPicker.title": "选择项目",
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

  it("interpolates the delete-message title placeholder in zh", () => {
    mod.setLocale("zh");
    expect(mod.translate("autopilots.detail.deleteMessage", { title: "晨报" })).toContain(
      "晨报",
    );
  });
});