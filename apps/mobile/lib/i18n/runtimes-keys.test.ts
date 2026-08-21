import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-32 runtimes browse/detail i18n. Same contract
// as skills-keys.test.ts: every key resolves in BOTH locales and the zh value
// is actually translated.
describe("runtimes i18n", () => {
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
    "nav.runtimes": "运行时",
    "screen.runtimes": "运行时",
    "runtimes.loadError": "加载运行时失败：",
    "runtimes.emptyTitle": "还没有运行时",
    "runtimes.emptyDescription": "运行时是 agents 绑定的执行后端（本地或云端）。daemon 启动并注册后，运行时会自动出现在这里。",
    "runtimes.health.online": "在线",
    "runtimes.health.recently_lost": "刚断连",
    "runtimes.health.offline": "离线",
    "runtimes.health.about_to_gc": "即将回收",
    "runtimes.mode.local": "本地",
    "runtimes.mode.cloud": "云端",
    "runtimes.kind.builtin": "内置",
    "runtimes.kind.custom": "自定义",
    "runtimes.visibility.public": "公开",
    "runtimes.visibility.private": "私有",
    "runtimes.detail.status": "状态",
    "runtimes.detail.mode": "类型",
    "runtimes.detail.provider": "提供方",
    "runtimes.detail.device": "设备",
    "runtimes.detail.daemon": "Daemon",
    "runtimes.detail.visibility": "可见性",
    "runtimes.detail.lastSeen": "最近在线",
    "runtimes.detail.createdAt": "创建时间",
    "runtimes.detail.updatedAt": "更新时间",
    "runtimes.detail.launch": "启动方式",
    "runtimes.detail.never": "从未",
    "runtimes.detail.diagnostics": "诊断",
    "runtimes.detail.readOnly": "只读",
    "runtimes.detail.visibilityHint.public": "工作区内的任何人都可以将其 agent 绑定到此运行时。",
    "runtimes.detail.renameButton": "重命名运行时",
    "runtimes.detail.renameApplyMachine": "同步应用到这台机器的所有运行时",
    "runtimes.detail.renameSave": "保存",
    "runtimes.detail.deleteButton": "删除运行时",
    "runtimes.detail.deleteConfirmTitle": "删除运行时？",
    "runtimes.detail.selfHealHint": "这是在线本地 daemon，删除后会自动重新注册。如需彻底移除，请先停止 daemon 进程。",
    "runtimes.notFound": "运行时不存在或已被移除",
    // iteration-82 A2 management dialogs (connect / cloud-runtime / profiles)
    "runtimes.actions.connect": "连接远程机器",
    "runtimes.actions.cloudRuntime": "云端运行时",
    "runtimes.actions.profiles": "自定义运行时",
    "runtimes.connect.title": "添加一台电脑",
    "runtimes.connect.step1Label": "安装 Multica CLI",
    "runtimes.connect.step2Label": "启动 daemon",
    "runtimes.connect.liveListening": "正在等待你的电脑",
    "runtimes.connect.troubleshooting": "在那台电脑上无法打开浏览器？",
    "runtimes.connect.successTitle": "电脑已连接",
    "runtimes.connect.createAgent": "创建 agent",
    "runtimes.cloudRuntime.title": "云端运行时",
    "runtimes.cloudRuntime.nodesTitle": "Fleet 节点",
    "runtimes.cloudRuntime.createTitle": "新建节点",
    "runtimes.cloudRuntime.notEnabledTitle": "云端运行时不可用",
    "runtimes.cloudRuntime.fields.instanceType": "实例类型",
    "runtimes.cloudRuntime.validation.diskSizeInvalid": "磁盘大小必须是正整数",
    "runtimes.profiles.addCustom": "添加自定义运行时",
    "runtimes.profiles.customSectionTitle": "自定义运行时（{{count}}）",
    "runtimes.profiles.builtinSectionHint": "内置协议族为只读参考项。",
    "runtimes.profiles.form.createTitle": "新建自定义运行时",
    "runtimes.profiles.form.familyLockedHint": "创建后基协议族不可更改。",
    "runtimes.profiles.form.errorShellSyntax": "不支持 shell 管道、重定向与控制操作符。请改用包装脚本。",
    "runtimes.profiles.form.commandPreviewArgs": "参数：",
    "runtimes.profiles.deleteDialog.errorBound": "仍有 agent 在使用此运行时，无法删除。",
    // iteration-83 A2.4 machine grouping + daemon update section
    "runtimes.machine.section_local": "本机",
    "runtimes.machine.section_remote": "远程",
    "runtimes.machine.section_cloud": "云端",
    "runtimes.machine.metrics.cli": "CLI",
    "runtimes.machine.metrics.runtimes_hint": "{{count}} 个在线",
    "runtimes.machine.metrics.workload_hint": "{{running}} 个运行中 · {{queued}} 个排队中",
    "runtimes.machine.metrics.workload_idle": "全部空闲",
    "runtimes.update.section_title": "版本与更新",
    "runtimes.update.cli_version_label": "CLI 版本：",
    "runtimes.update.version_unknown": "未知",
    "runtimes.update.managed_by_desktop": "由桌面端管理",
    "runtimes.update.read_only": "只读",
    "runtimes.update.local_build": "本地构建",
    "runtimes.update.latest": "最新",
    "runtimes.update.available": "可用",
    "runtimes.update.action": "更新",
    "runtimes.update.retry": "重试",
    "runtimes.update.unknown_error": "未知错误",
    "runtimes.update.initiate_failed": "启动更新失败",
    "runtimes.update.status.pending": "等待守护进程...",
    "runtimes.update.status.running": "更新中...",
    "runtimes.update.status.completed": "更新完成。守护进程正在重启...",
    "runtimes.update.status.failed": "更新失败",
    "runtimes.update.status.timeout": "超时",
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

  it("labels the four derived health states in english", () => {
    for (const [key, en] of [
      ["runtimes.health.online", "Online"],
      ["runtimes.health.recently_lost", "Recently lost"],
      ["runtimes.health.offline", "Offline"],
      ["runtimes.health.about_to_gc", "About to GC"],
    ] as const) {
      expect(mod.translate(key)).toBe(en);
    }
  });
});