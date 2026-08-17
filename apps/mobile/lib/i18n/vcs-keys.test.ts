import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Spot-checks for the iteration-59 VCS integration i18n. Same contract as
// workspace-integrations-keys.test.ts: every key resolves in BOTH locales,
// interpolation params work, and the zh value is actually translated.
describe("VCS integration i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("./index");
  }

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const EN_KEYS = [
    "integrations.vcsTitle",
    "integrations.vcsDescription",
    "integrations.vcsConnectedAs",
    "integrations.vcsRegenerate",
    "integrations.vcsDisconnect",
    "integrations.vcsConnectTitle",
    "integrations.vcsInstanceUrl",
    "integrations.vcsInstanceUrlPlaceholder",
    "integrations.vcsToken",
    "integrations.vcsTokenPlaceholder",
    "integrations.vcsTokenHint",
    "integrations.vcsConnect",
    "integrations.vcsConnecting",
    "integrations.vcsWebhookSetupTitle",
    "integrations.vcsWebhookSetupDesc",
    "integrations.vcsWebhookUrl",
    "integrations.vcsWebhookSecret",
    "integrations.vcsWebhookSecretWarning",
    "integrations.vcsCopyFailed",
    "integrations.vcsRotateTitle",
    "integrations.vcsRotateDesc",
    "integrations.vcsRotateConfirm",
    "integrations.vcsDisconnectTitle",
    "integrations.vcsDisconnectDesc",
    "integrations.vcsDisconnectConfirm",
    "integrations.vcsNotConfigured",
    "integrations.vcsContactAdmin",
    "integrations.vcsLoadFailed",
    "integrations.vcsConnectFailed",
    "integrations.vcsRotateFailed",
    "integrations.vcsDisconnectFailed",
    "integrations.vcsUnknownError",
  ];

  it("resolves every VCS key in both locales", () => {
    for (const key of EN_KEYS) {
      expect(mod.translate(key)).not.toBe(key);
    }
    mod.setLocale("zh");
    const zhValues = EN_KEYS.map((key) => mod.translate(key));
    // zh must resolve and genuinely differ from the English copy (translated,
    // not copied verbatim) — except the instance-URL placeholder, which is a
    // bare URL that legitimately reads the same in both locales.
    for (const key of EN_KEYS) {
      expect(mod.translate(key)).not.toBe(key);
    }
    mod.setLocale("en");
    const enValues = EN_KEYS.map((key) => mod.translate(key));
    EN_KEYS.forEach((key, i) => {
      if (key === "integrations.vcsInstanceUrlPlaceholder") {
        expect(zhValues[i]).toBe(enValues[i]);
      } else {
        expect(zhValues[i]).not.toBe(enValues[i]);
      }
    });
  });

  it("interpolates params for connected-as and error messages", () => {
    expect(mod.translate("integrations.vcsConnectedAs", { login: "octocat" })).toContain(
      "octocat",
    );
    expect(
      mod.translate("integrations.vcsConnectFailed", { message: "boom" }),
    ).toContain("boom");
    expect(
      mod.translate("integrations.vcsRotateDesc", { label: "Forgejo · x.com" }),
    ).toContain("Forgejo · x.com");
  });
});