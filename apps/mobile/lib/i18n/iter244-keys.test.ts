import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * Spot-checks for the two-layer instruction copy (MYS-2162).
 *
 * The zh values are pinned to web's `agents.json` wording verbatim rather than
 * paraphrased — the same agent, label and field must read the same on both
 * clients, and a mobile-only rewording is how the two drift into disagreeing.
 * Web's originals (packages/views/locales/zh-Hans/agents.json):
 *
 *   tab_body.instructions.system_layer_label    由 Multica 维护
 *   tab_body.instructions.system_layer_hint     随 Multica 版本更新。你无法编辑这部分，你在下面写的内容也永远不会被覆盖。
 *   tab_body.instructions.system_layer_show     查看
 *   tab_body.instructions.system_layer_hide     收起
 *   tab_body.instructions.workspace_notes_label 工作区补充
 *   tab_body.instructions.workspace_notes_placeholder 写下这个智能体应该始终知道的上下文。
 *   tab_body.instructions.workspace_notes_intro 在下面补充你们团队的上下文和偏好，它们会叠加在 Multica 为这个智能体维护的指令之上。支持 Markdown。
 *
 * Two deliberate mobile differences, both recorded here so a later round has to
 * argue with them rather than re-discover them:
 *
 *   1. `workspaceIntro` drops web's trailing 「支持 Markdown。」 — mobile's
 *      instruction field is a plain `AutosizeTextArea`, not web's markdown
 *      editor, so promising markdown support would be a claim the field does
 *      not honour.
 *   2. `detail.instructionsWorkspaceEmpty` has no web counterpart (web's tab
 *      always has the editable textarea, empty or not), so it is mobile copy.
 */
describe("system-agent instruction i18n (MYS-2162)", () => {
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
    "agents.systemLayer.label": "由 Multica 维护",
    "agents.systemLayer.hint":
      "随 Multica 版本更新。你无法编辑这部分，你在下面写的内容也永远不会被覆盖。",
    "agents.systemLayer.show": "查看",
    "agents.systemLayer.hide": "收起",
    "agents.instructions.workspaceLabel": "工作区补充",
    "agents.instructions.workspacePlaceholder": "写下这个智能体应该始终知道的上下文。",
    "agents.instructions.workspaceIntro":
      "你写的内容会叠加在 Multica 为这个智能体维护的指令之上，且永远不会被覆盖。",
    "agents.detail.instructions": "指令",
    "agents.detail.instructionsWorkspaceEmpty": "该工作区还没有补充内容。",
  };

  it("resolves every key in both locales with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, `${key} missing from en`).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);
      // The en tag must not be the zh string copied across — that satisfies a
      // presence check while shipping Chinese to an English reader.
      expect(/[一-鿿]/.test(en), `${key} en value contains CJK`).toBe(false);

      mod.setLocale("zh");
      expect(mod.translate(key), `${key} zh`).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("keeps the workspace-notes field distinct from the plain instructions field", () => {
    // The whole point of the fix: a system agent's editable half must not read
    // 「指令」, because that is what the product half is. If these ever coincide
    // the mislabelling is back.
    mod.setLocale("zh");
    const layered = mod.translate("agents.instructions.workspaceLabel");
    const plain = mod.translate("agents.new.instructionsLabel");
    expect(layered).not.toBe(plain);
    const layeredPlaceholder = mod.translate("agents.instructions.workspacePlaceholder");
    const plainPlaceholder = mod.translate("agents.new.instructionsPlaceholder");
    expect(layeredPlaceholder).not.toBe(plainPlaceholder);
    mod.setLocale("en");
  });

  it("says the workspace notes are never overwritten and apply on top", () => {
    // The two facts the reader cannot infer from the field itself, and the ones
    // a wrong mental model turns on: their text is additive, and a release
    // never clobbers it.
    for (const locale of ["zh", "en"] as const) {
      mod.setLocale(locale);
      const intro = mod.translate("agents.instructions.workspaceIntro");
      expect(intro.length, `${locale} intro`).toBeGreaterThan(0);
      expect(mod.translate("agents.systemLayer.hint").length).toBeGreaterThan(0);
    }
    mod.setLocale("zh");
    expect(mod.translate("agents.instructions.workspaceIntro")).toContain("永远不会被覆盖");
    expect(mod.translate("agents.systemLayer.hint")).toContain("无法编辑");
    mod.setLocale("en");
  });

  it("does not promise markdown support the mobile field lacks", () => {
    // Web's intro ends 「支持 Markdown。」 because web edits markdown. Mobile's is
    // a plain textarea, so the claim is deliberately absent — pinned so a later
    // "sync with web" pass does not paste it back in.
    for (const locale of ["zh", "en"] as const) {
      mod.setLocale(locale);
      expect(mod.translate("agents.instructions.workspaceIntro")).not.toContain("Markdown");
      expect(mod.translate("agents.instructions.workspaceIntro")).not.toContain("markdown");
    }
  });

  it("leaves the plain instructions label untouched", () => {
    // The other half of the contract: the layered branch is added BESIDE the
    // existing copy, not by rewording it. Every ordinary agent keeps reading
    // exactly what it read before (pinned in agents-keys.test.ts).
    mod.setLocale("zh");
    expect(mod.translate("agents.new.instructionsLabel")).toBe("指令");
    expect(mod.translate("agents.new.instructionsPlaceholder")).toBe(
      "写下这个智能体该做什么、关注什么、要避开什么…",
    );
  });
});
