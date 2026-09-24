import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

async function loadI18n() {
  return await import("./i18n");
}

/**
 * Issue dates must follow the APP language, not the device language — the two
 * are independent settings, and an undefined `locale` makes Intl fall back to
 * the device (a zh UI on an en phone renders "Sep 24").
 */
describe("formatIssueDate locale", () => {
  beforeEach(async () => {
    const i18n = await loadI18n();
    i18n.resetI18nForTests();
  });

  it("formats in en-US when the app locale is en", async () => {
    const i18n = await loadI18n();
    const { formatIssueDate } = await import("./format-date");
    i18n.setLocale("en");
    expect(formatIssueDate("2026-09-24")).toBe("Sep 24");
  });

  it("formats in Chinese when the app locale is zh", async () => {
    const i18n = await loadI18n();
    const { formatIssueDate } = await import("./format-date");
    i18n.setLocale("zh");
    expect(formatIssueDate("2026-09-24")).toBe("9月24日");
  });

  it("never shifts the calendar day with the viewer's timezone", async () => {
    const i18n = await loadI18n();
    const { formatIssueDate } = await import("./format-date");
    i18n.setLocale("en");
    // Anchored at UTC midnight: a local-time read would slip a day westward.
    expect(formatIssueDate("2026-01-01", { month: "numeric", day: "numeric" })).toBe("1/1");
  });

  it("returns an empty string for missing or unparseable values", async () => {
    const { formatIssueDate } = await import("./format-date");
    expect(formatIssueDate(null)).toBe("");
    expect(formatIssueDate(undefined)).toBe("");
    expect(formatIssueDate("not-a-date")).toBe("");
  });

  it("maps the app locale to a zh-CN / en-US Intl tag", async () => {
    const i18n = await loadI18n();
    i18n.setLocale("zh");
    expect(i18n.getIntlLocale()).toBe("zh-CN");
    i18n.setLocale("en");
    expect(i18n.getIntlLocale()).toBe("en-US");
    expect(i18n.getIntlLocale("zh")).toBe("zh-CN");
  });
});
