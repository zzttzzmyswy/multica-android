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
    // Iteration-104 web alignment: full delivery detail (badges / meta grid /
    // replay hints / truncation).
    "autopilots.deliveries.row.replayBadge": "重放",
    "autopilots.deliveries.row.attempts": "{{count}} 次尝试",
    "autopilots.deliveries.availableAt": "下次分发时间",
    "autopilots.deliveries.dedupeKey": "去重 Key",
    "autopilots.deliveries.dedupeSource": "去重来源",
    "autopilots.deliveries.contentType": "Content-Type",
    "autopilots.deliveries.replayedFrom": "重放自",
    "autopilots.deliveries.replay.disabledInvalidSignature": "无法重放——签名校验失败",
    "autopilots.deliveries.replay.disabledRejected": "无法重放已拒绝的投递",
    "autopilots.deliveries.replay.disabledQueued": "投递仍在排队，处理完成后再重放",
    "autopilots.deliveries.truncatedMarker": "[已截断——点击复制获取完整内容]",
    // Iteration-111 web alignment: webhook trigger payload preview
    // (WebhookPayloadPreview).
    "autopilots.webhookPayload.label": "Webhook 事件：",
    "autopilots.webhookPayload.unknownEvent": "webhook.received",
    "autopilots.webhookPayload.view": "查看载荷",
    "autopilots.webhookPayload.none": "该 run 无触发载荷",
    "autopilots.webhookPayload.payload": "Payload",
    "autopilots.webhookPayload.contentType": "Content-Type：{{type}}",
    "autopilots.webhookPayload.copy": "复制",
    "autopilots.webhookPayload.copiedShort": "已复制",
    "autopilots.webhookPayload.truncatedMarker": "[已截断——点击\"复制\"获取完整 payload]",
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
    // Iteration-105 web alignment: empty-state quick-start templates.
    "autopilots.startBlank": "从空白开始",
    "autopilots.templates.daily_news.title": "每日新闻摘要",
    "autopilots.templates.daily_news.summary": "检索并汇总今天的团队相关新闻",
    "autopilots.templates.pr_review.title": "PR 审阅提醒",
    "autopilots.templates.bug_triage.title": "缺陷分类",
    "autopilots.templates.weekly_progress.title": "每周进度报告",
    "autopilots.templates.dependency_audit.title": "依赖审计",
    "autopilots.templates.documentation_check.title": "文档检查",
    // Iteration-109 web alignment: schedule editor (at / every / weekly /
    // monthly / advanced cron + next-runs preview).
    "autopilots.schedule_editor.time_label": "时间",
    "autopilots.schedule_editor.time_at": "定点",
    "autopilots.schedule_editor.time_every": "按间隔",
    "autopilots.schedule_editor.days_label": "重复",
    "autopilots.schedule_editor.days_monthly": "每月",
    "autopilots.schedule_editor.next_runs_label": "接下来",
    "autopilots.schedule_editor.cron_invalid": "该 cron 表达式无效。",
    "autopilots.schedule_editor.describe.time_every_minutes": "每 {{interval}} 分钟",
    "autopilots.schedule_editor.describe.days_monthly": "每月 {{day}} 日",
    "autopilots.schedule_editor.countdown.less_than_minute": "不到 1 分",
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