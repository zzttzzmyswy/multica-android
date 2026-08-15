import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

async function loadI18n() {
  return await import("./index");
}

// Regression coverage for the iteration-14 deep-constant i18n: agent task
// status pills, time-ago phrases, failure reasons, elapsed captions, timeline
// step labels, and the composer/editor toolbar accessibility labels. These
// back `status-pill.tsx`, `time-ago.ts`, `failure-reason-label.ts`,
// `chat-message-list.tsx`, `chat-timeline.tsx`, `markdown-toolbar.tsx` and
// `message-composer.tsx`.
describe("deep-constant i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  it("localizes agent task status stage labels in zh", () => {
    const keys = {
      "status.retrying": "重试中",
      "status.offline": "离线",
      "status.reconnecting": "重新连接",
      "status.queued": "排队中",
      "status.startingUp": "启动中",
      "status.thinking": "思考中",
      "status.typing": "输入中",
      "status.working": "工作中",
    };
    for (const [k, zh] of Object.entries(keys)) {
      expect(mod.translate(k)).not.toBe(k); // en present
      mod.setLocale("zh");
      expect(mod.translate(k)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("localizes agent tool activity labels in zh", () => {
    const keys = {
      "tool.command": "运行命令",
      "tool.reading": "读取文件",
      "tool.searchingCode": "搜索代码",
      "tool.makingEdits": "编辑中",
      "tool.searchingWeb": "搜索网页",
    };
    for (const [k, zh] of Object.entries(keys)) {
      mod.setLocale("zh");
      expect(mod.translate(k)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("localizes time-ago phrases with count interpolation", () => {
    expect(mod.translate("time.justNow")).toBe("Just now");
    expect(mod.translate("time.minutesAgo", { count: 5 })).toBe("5m ago");
    expect(mod.translate("time.hoursAgo", { count: 3 })).toBe("3h ago");
    mod.setLocale("zh");
    expect(mod.translate("time.justNow")).toBe("刚刚");
    expect(mod.translate("time.minutesAgo", { count: 5 })).toBe("5分钟前");
    expect(mod.translate("time.hoursAgo", { count: 3 })).toBe("3小时前");
    expect(mod.translate("time.daysAgo", { count: 2 })).toBe("2天前");
    expect(mod.translate("time.weeksAgo", { count: 1 })).toBe("1周前");
  });

  it("localizes failure-reason keys in zh and drops to failed cover", () => {
    mod.setLocale("zh");
    expect(mod.translate("failureReason.runtime_offline")).toBe("守护进程离线");
    expect(mod.translate("failureReason.agent_error.provider_quota_limit")).toBe(
      "提供商配额已耗尽",
    );
    // An unrecognised reason degrades to the failed coverage label.
    expect(mod.translate("failureReason.failed")).toBe("失败");
    mod.setLocale("en");
    expect(mod.translate("failureReason.failed")).toBe("Failed");
  });

  it("localizes elapsed and no-reply captions for chat bubbles", () => {
    expect(
      mod.translate("chat.repliedIn", { elapsed: "39s" }),
    ).toBe("Replied in 39s");
    expect(mod.translate("chat.finishedWithoutReply")).toBe(
      "The agent finished this turn without a text reply.",
    );
    mod.setLocale("zh");
    expect(mod.translate("chat.repliedIn", { elapsed: "39s" })).toBe(
      "在 39s 内回复",
    );
    expect(mod.translate("chat.finishedWithoutReply")).toBe(
      "agent 已结束本轮，但未返回文字回复。",
    );
  });

  it("localizes timeline step / result labels", () => {
    expect(mod.translate("chat.nSteps", { count: 3 })).toBe("3 steps");
    expect(mod.translate("chat.oneStep")).toBe("1 step");
    expect(mod.translate("chat.resultPrefix", { tool: "bash" })).toBe(
      "bash result: ",
    );
    expect(mod.translate("chat.resultPrefixNoTool")).toBe("result: ");
    mod.setLocale("zh");
    expect(mod.translate("chat.nSteps", { count: 3 })).toBe("3 步");
    expect(mod.translate("chat.oneStep")).toBe("1 步");
    expect(mod.translate("chat.resultPrefix", { tool: "bash" })).toBe(
      "bash 结果：",
    );
    expect(mod.translate("chat.resultPrefixNoTool")).toBe("结果：");
  });

  it("localizes composer/editor toolbar accessibility labels", () => {
    expect(mod.translate("a11y.send")).toBe("Send");
    expect(mod.translate("a11y.attachFile")).toBe("Attach file");
    mod.setLocale("zh");
    expect(mod.translate("a11y.send")).toBe("发送");
    expect(mod.translate("a11y.attachFile")).toBe("附加文件");
    expect(mod.translate("a11y.codeBlock")).toBe("代码块");
    expect(mod.translate("a11y.mentionSomeone")).toBe("提及某个人或某个问题");
  });

  it("en/zh dictionaries are mirror images for the deep-constant keys", () => {
    const sample = [
      "status.thinking",
      "tool.reading",
      "time.justNow",
      "failureReason.failed",
      "chat.repliedIn",
      "chat.nSteps",
      "chat.resultPrefixNoTool",
      "a11y.send",
      "a11y.attachImage",
      "comment.edited",
      "comment.resolvedBar",
    ];
    for (const key of sample) {
      expect(mod.translate(key)).not.toBe(key); // present in en
      mod.setLocale("zh");
      expect(mod.translate(key)).not.toBe(key); // present in zh
      mod.setLocale("en");
    }
  });

  it("localizes mention-suggestion rows, upload errors, pins, project props", () => {
    expect(mod.translate("mention.recent")).toBe("Recent");
    expect(mod.translate("mention.members")).toBe("Members");
    expect(mod.translate("picker.agents")).toBe("Agents");
    expect(mod.translate("common.uploadFailed")).toBe("Upload failed");
    expect(mod.translate("project.progress")).toBe("Progress");
    expect(mod.translate("pins.unavailable", { itemType: "issue" })).toBe(
      "Unavailable issue — tap to unpin",
    );
    mod.setLocale("zh");
    expect(mod.translate("mention.recent")).toBe("最近");
    expect(mod.translate("mention.members")).toBe("成员");
    expect(mod.translate("project.progress")).toBe("进度");
    expect(mod.translate("common.uploadFailed")).toBe("上传失败");
    expect(mod.translate("a11y.openFile", { filename: "a.png" })).toBe(
      "打开 a.png",
    );
    expect(mod.translate("a11y.currentWorkspace", { name: "Acme" })).toBe(
      "Acme，当前工作区",
    );
    // zh timeline "new" chip must not duplicate the message unit.
    expect(mod.translate("timeline.newCount", { count: 2 })).toBe("2 条新内容");
    expect(mod.translate("timeline.jumpToNew", { count: 2, messages: "条消息" })).toBe(
      "跳至 2 条新内容",
    );
    expect(mod.translate("chat.noAgentsEmpty")).toBe("暂无可用 agent。");
    expect(mod.translate("a11y.removeMention", { name: "Alice" })).toBe(
      "移除提及 Alice",
    );
  });
});