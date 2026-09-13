import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// i18n spot-checks for iteration 124 — the machine-detail screen
// (`more/runtimes/machine/[machineId].tsx`) and the runtimes list's machine
// header. Same contract as iter119/…/iter123-keys.test.ts: every key resolves
// in BOTH locales and the zh value is a real translation, not the raw-id
// fallback.
//
// `runtime_count` is the load-bearing one: mobile's `translate()` does no
// plural resolution, so the `_one` / `_other` variants that already existed
// are never looked up. Without the base key the header printed the raw id.
describe("runtime machine detail i18n (iteration 124)", () => {
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
    // Queue-send slot (web chat-input `queue_send_tooltip` — "排队发送").
    "a11y.queueSend": "排队发送",
    // Autopilot runbook body — web `detail.field_prompt`.
    "autopilots.detail.fieldPrompt": "提示词",
    "runtimes.machine.actions": "机器操作",
    "runtimes.machine.open": "打开机器 {{name}}",
    "runtimes.machine.runtime_count": "{{count}} 个运行时",
    "runtimes.machine.rename": "重命名机器",
    "runtimes.machine.not_found_title": "未找到机器",
    "runtimes.machine.no_runtimes_title": "还没有注册运行时",
    "runtimes.machine.select_runtime":
      "内置运行时会自动出现。选择一项查看设置，或添加自定义命令。",
    "runtimes.machine.metrics.runtimes": "运行时",
    "runtimes.machine.metrics.workload_idle": "全部空闲",
    "runtimes.machine.section_local": "本机",
    "runtimes.machine.section_remote": "远程",
    "runtimes.machine.section_cloud": "云端",
  };

  it("resolves every iteration-124 key in both locales", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const enValue = mod.translate(key);
      expect(enValue, `en fallback leak: ${key}`).not.toBe(key);
      expect(enValue.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key)).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("renders a plural count without a plural-suffix lookup", () => {
    // The screen calls this key with `count` for every runtime count, so the
    // base key must interpolate on its own — `runtime_count_one` /
    // `runtime_count_other` are dead entries for this renderer.
    mod.setLocale("en");
    expect(mod.translate("runtimes.machine.runtime_count", { count: 1 })).toBe(
      "1 runtimes",
    );
    mod.setLocale("zh");
    expect(mod.translate("runtimes.machine.runtime_count", { count: 3 })).toBe(
      "3 个运行时",
    );
  });

  it("interpolates the machine name and the workload breakdown", () => {
    mod.setLocale("en");
    expect(
      mod.translate("runtimes.machine.open", { name: "Zeus" }),
    ).toBe("Open machine Zeus");
    expect(
      mod.translate("runtimes.machine.metrics.workload_hint", {
        running: 2,
        queued: 5,
      }),
    ).toBe("2 running · 5 queued");
    mod.setLocale("zh");
    expect(
      mod.translate("runtimes.machine.metrics.workload_hint", {
        running: 2,
        queued: 5,
      }),
    ).toBe("2 个运行中 · 5 个排队中");
  });
});
