/**
 * Wiring guard for the start-date inbox row.
 *
 * Web renders `start_date_changed` as "Set start date to <day>" / "Removed
 * start date" (`packages/views/inbox/components/inbox-detail-label.tsx:91-94`,
 * labels `set_start_date_to` / `removed_start_date`). Mobile's switch covered
 * every other type — including the twin `due_date_changed` — but had no
 * `start_date_changed` case at all, so the row fell through to the generic
 * type label ("Start date changed") and dropped the day the user actually
 * needs. Mobile's vitest lane is Node-only (see vitest.config.ts): there is no
 * RN renderer, so a locale key nobody renders fixes nothing. This guard pins
 * the source shape *and* the two keys behind it.
 *
 * Comments are stripped before matching, so a comment quoting the branch
 * cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// This file lives in `lib/`, so one level up is the mobile app root.
const APP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "../..");

function code(abs: string): string {
  return readFileSync(abs, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DETAIL = path.join(APP_ROOT, "components/inbox/detail-label.tsx");
const WEB_DETAIL = path.join(
  REPO_ROOT,
  "packages/views/inbox/components/inbox-detail-label.tsx",
);

describe("inbox start-date row", () => {
  const detail = code(DETAIL);

  it("keeps web's start_date_changed branch as the parity target", () => {
    const web = code(WEB_DETAIL);
    expect(web).toMatch(/case "start_date_changed"/);
    expect(web).toMatch(/set_start_date_to/);
    expect(web).toMatch(/removed_start_date/);
  });

  it("has a start_date_changed branch of its own", () => {
    expect(detail).toMatch(/case "start_date_changed"/);
  });

  it("shows the day when a start date is set", () => {
    expect(detail).toMatch(
      /t\(\s*"inbox\.setStartDate"\s*,\s*\{\s*date:\s*shortDate\(details\.to,\s*intlLocale\)\s*\}\s*\)/,
    );
  });

  it("shows a removal when the start date is cleared", () => {
    expect(detail).toMatch(/t\(\s*"inbox\.removedStartDate"\s*\)/);
  });

  it("branches on details.to, so a cleared date never renders as a set", () => {
    const branch = detail.slice(detail.indexOf('case "start_date_changed"'));
    const setAt = branch.indexOf("inbox.setStartDate");
    const removedAt = branch.indexOf("inbox.removedStartDate");
    const ternaryAt = branch.indexOf("details.to");
    expect(setAt).toBeGreaterThan(-1);
    expect(removedAt).toBeGreaterThan(setAt);
    expect(ternaryAt).toBeGreaterThan(-1);
    expect(ternaryAt).toBeLessThan(setAt);
  });
});

describe("inbox start-date locale keys", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("./i18n/index");
  }

  beforeEach(async () => {
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH: Record<string, string> = {
    "inbox.setStartDate": "将开始日期设为 {{date}}",
    "inbox.removedStartDate": "移除了开始日期",
  };

  it("resolves both keys in en and zh, with a real zh translation", () => {
    for (const [key, zh] of Object.entries(ZH)) {
      expect(mod.translate(key), key).not.toBe(key);
      mod.setLocale("zh");
      expect(mod.translate(key), key).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("renders the day through the shared timezone-safe date formatter", () => {
    mod.setLocale("en");
    expect(mod.translate("inbox.setStartDate", { date: "Mar 3" })).toBe(
      "Set start date to Mar 3",
    );
  });
});
