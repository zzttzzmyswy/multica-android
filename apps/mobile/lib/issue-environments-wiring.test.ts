import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

/**
 * Wiring guards for iteration 299 (MYS-2980) — the issue environments section.
 *
 * The pure rules are covered by `lib/issue-environments.test.ts` and the wire
 * shape by `data/schemas-issue-environment.test.ts`. What neither can see is
 * whether the page actually USES them. The properties below are the ones the
 * issue states by name and that only the source can answer:
 *
 *  1. the section is mounted on the issue page at all (the whole point — the
 *     feature was absent, not merely wrong);
 *  2. it polls while a command is in flight, and stops when none is;
 *  3. every row capability goes through ONE `rowCapabilities` call, so a row
 *     cannot offer a stop the machine will refuse;
 *  4. `environment:changed` reaches this issue's cache and no other;
 *  5. the section renders NOTHING when it has nothing — an always-present
 *     empty block would be a permanent no-op row on most issues.
 */
const APP_ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8");
}

const SECTION = "components/issue/issue-environments-section.tsx";
const TIMELINE = "components/issue/timeline-list.tsx";
const QUERIES = "data/queries/issues.ts";
const REALTIME = "data/realtime/use-issue-realtime.ts";
const LOG_SHEET = "components/issue/environment-log-sheet.tsx";

describe("issue environments wiring", () => {
  it("fixture sanity: every surface exists and is non-trivial", () => {
    expect(read(SECTION).length).toBeGreaterThan(8000);
    expect(read(LOG_SHEET).length).toBeGreaterThan(3000);
    expect(read(TIMELINE)).toContain("IssueEnvironmentsSection");
  });

  it("mounts the section on the issue page, once", () => {
    const timeline = read(TIMELINE);
    expect(timeline.match(/<IssueEnvironmentsSection\b/g) ?? []).toHaveLength(1);
    // Inside the scrolling header block, next to the other sidebar mirrors.
    expect(timeline).toContain('import { IssueEnvironmentsSection } from "./issue-environments-section"');
  });

  it("polls at 5s only while a command is pending, and idles at 60s", () => {
    const queries = read(QUERIES);
    const block = queries.slice(queries.indexOf("issueEnvironmentsOptions"));
    // The short interval must be gated on a pending signal, never unconditional:
    // an unconditional 5s poll is a request per row per 5s for every open issue.
    expect(block).toContain("pending_starts.length > 0");
    expect(block).toContain('pending_action?.status === "pending"');
    expect(block).toContain("return pending ? 5_000 : 60_000");
  });

  it("polls a log command at 1s while pending and never again", () => {
    const queries = read(QUERIES);
    expect(queries).toContain("issueEnvironmentCommandOptions");
    expect(queries).toContain('query.state.data?.status === "pending" ? 1_000 : false');
  });

  it("decides row capabilities in exactly one place", () => {
    const section = read(SECTION);
    // One call site per row render: a second `rowCapabilities` (or a hand-rolled
    // `canStop &&`) is how web's four gates get re-derived wrongly at one site.
    expect(section).toContain("rowCapabilities(env, { offline: access.offline })");
    expect(section).not.toMatch(/can_stop_here|allowStop\s*=/);
  });

  it("routes every control through the one mutation", () => {
    const section = read(SECTION);
    expect(section).toContain("useControlIssueEnvironment");
    // No direct api.* control call from the view: the invalidation lives in the
    // mutation, and calling the client straight from a Pressable would skip it.
    expect(section).not.toContain("api.stopIssueEnvironment");
    expect(section).not.toContain("api.restartIssueEnvironment");
    expect(section).not.toContain("api.startIssueEnvironment");
  });

  it("invalidates this issue's environments on environment:changed, gated by issue id", () => {
    const realtime = read(REALTIME);
    const idx = realtime.indexOf('ws.on("environment:changed"');
    expect(idx).toBeGreaterThan(-1);
    const handler = realtime.slice(idx, idx + 400);
    // The gate comes first: another issue's event must not refetch this cache.
    expect(handler).toContain("payload.issue_id !== issueId");
    expect(handler).toContain("issueKeys.environments(wsId, issueId)");
  });

  it("renders nothing when there is nothing to show", () => {
    const section = read(SECTION);
    expect(section).toContain("if (!hasAnything) return null;");
    // And the gate covers every kind of row, not just live ones — an issue with
    // only a startable declared environment still shows the section.
    for (const part of [
      "live.length > 0",
      "pinned.length > 0",
      "shownStarts.length > 0",
      "shownFailures.length > 0",
      "ended.length > 0",
      "startable",
    ]) {
      expect(section).toContain(part);
    }
  });

  it("requires a DECLARED environment, not merely a machine that ran", () => {
    // Verified live against mu.zztweb.top: `configs` carries one entry per
    // machine that ran the issue, and most declare `environments: []`
    // (MYS-2973 answers two configs, both empty). Gating the section on the
    // config COUNT therefore put an empty header with a dead "+" on nearly
    // every issue that ever ran — the exact no-op row the guard above forbids.
    const section = read(SECTION);
    expect(section).toContain("config.environments.length > 0");
    expect(section).toContain("config.can_control &&");
    // The bare count must not be the gate anywhere.
    expect(section).not.toContain("configs.length > 0 ?");
  });

  it("offers the log sheet from a declared row and from a pinned crash", () => {
    const section = read(SECTION);
    expect(section).toContain("<EnvironmentLogSheet");
    expect(section).toContain("canReadLogs");
    // A crashed row keeps its two exits inline (web does the same).
    expect(section).toContain('t("environments.viewLogs")');
  });

  it("asks an agent with the start command the server recognizes", () => {
    const section = read(SECTION);
    // The instruction string lives in the bundle (translators need it), and the
    // command it names is what `preparingRun` matches on. If the two drift, the
    // "preparing" row stops appearing for a start the reader just asked for.
    expect(section).toContain('t("environments.startMenu.agentInstruction")');
    const zh = JSON.parse(read("lib/i18n/locales/zh.json")) as Record<string, string>;
    const en = JSON.parse(read("lib/i18n/locales/en.json")) as Record<string, string>;
    for (const bundle of [zh, en]) {
      expect(bundle["environments.startMenu.agentInstruction"]).toContain("multica env start");
    }
  });

  it("keeps the follow interval out of the shared configurable path", () => {
    // 5s is web's `FOLLOW_INTERVAL`; changing it here without web is a silent
    // divergence in how fresh a followed log reads.
    expect(read(LOG_SHEET)).toContain("const FOLLOW_INTERVAL = 5_000");
  });

  it("has a translation for every string the section renders", () => {
    const zh = JSON.parse(read("lib/i18n/locales/zh.json")) as Record<string, string>;
    const en = JSON.parse(read("lib/i18n/locales/en.json")) as Record<string, string>;
    const sources = [read(SECTION), read(LOG_SHEET)].join("\n");
    const used = new Set(
      [...sources.matchAll(/t\(\s*"(environments\.[A-Za-z0-9_.]+)"/g)].map((m) => m[1]!),
    );
    expect(used.size).toBeGreaterThan(30);
    const missing = [...used].filter((key) => !(key in zh) || !(key in en));
    expect(missing).toEqual([]);
  });

  it("renders every environment state through a key that exists", () => {
    // The two state strings are built by template (`environments.state.${s}`),
    // so the scan above cannot see them — and a missing one renders as the raw
    // key on the row, which reads as a bug rather than as a state.
    const zh = JSON.parse(read("lib/i18n/locales/zh.json")) as Record<string, string>;
    const en = JSON.parse(read("lib/i18n/locales/en.json")) as Record<string, string>;
    const states = [
      "starting",
      "running",
      "exited",
      "stopped",
      "unreachable",
      "stopping",
      "preparing",
    ];
    // `stopping` and `preparing` are client-only states; all seven are reached.
    expect(read(SECTION) + read(LOG_SHEET)).toContain("environments.state.${caps.rowState}");
    for (const state of states) {
      const key = `environments.state.${state}`;
      expect(zh[key], `zh missing ${key}`).toBeTruthy();
      expect(en[key], `en missing ${key}`).toBeTruthy();
    }
  });

  it("picks the plural suffix at the call site, since there is no engine", () => {
    // `translate()` is a flat dictionary lookup — no `_one` / `_other`
    // resolution. A key ending in `_one` that nothing selects explicitly would
    // never render, and its `_other` twin would never be reached either.
    const sheet = read(LOG_SHEET);
    expect(sheet).toContain('lines.length === 1');
    expect(sheet).toContain('"environments.log.footer_one"');
    expect(sheet).toContain('"environments.log.footer_other"');
    const zh = JSON.parse(read("lib/i18n/locales/zh.json")) as Record<string, string>;
    // No other environment key may carry a suffix nothing resolves.
    const orphans = Object.keys(zh).filter(
      (key) =>
        key.startsWith("environments.") &&
        /_(one|other)$/.test(key) &&
        !key.startsWith("environments.log.footer"),
    );
    expect(orphans).toEqual([]);
  });

  it("resolves every state tone, including the client-only `stopping`", () => {
    const section = read(SECTION);
    // A state with no tone renders in the default colour — a running row would
    // read the same as a dead one.
    for (const state of ["starting", "running", "unreachable", "exited", "stopped", "stopping"]) {
      expect(section).toMatch(new RegExp(`^  ${state}:`, "m"));
    }
  });
});
