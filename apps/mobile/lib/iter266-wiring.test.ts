import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Wiring for iteration 266 (MYS-2300).
 *
 * `lib/run-row-meta.test.ts` and `lib/run-trigger-label.test.ts` lock the pure
 * decisions; this file locks the CALLING. A helper nobody calls fixes nothing,
 * and the mobile vitest lane is Node-only by design (`vitest.config.ts` — the
 * app runs on Hermes, so an RN renderer here would assert a runtime we do not
 * ship). These assertions read the source the way every `*-wiring.test.ts` in
 * this folder does.
 *
 * The two gaps:
 *
 *  1. **A run row stated its token count and nothing else.** Web's row also
 *     says how long the run took, which model burned the tokens, and what they
 *     cost — the three facts that turn "8.2K tokens" into "was this worth it".
 *     The risk is not the arithmetic (that is tested), it is a row that imports
 *     the helpers and then draws only one of them, or a cost that never
 *     re-prices when a custom rate is saved.
 *
 *  2. **A wakeup-triggered run was indistinguishable from a hand-started one.**
 *     The judge is `task.wakeup_id`, and the rule is read through the issue's
 *     SHARED cache. A per-row `useQuery` on a fresh key would be one request
 *     per row, and a label built from `trigger_summary` alone would print the
 *     rule's instruction as if a person had typed it.
 */
const APP = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const RUN_ROW = "components/issue/run-row.tsx";
const RUN_WAKEUP = "data/queries/run-wakeup.ts";
const RUN_ROW_META = "lib/run-row-meta.ts";
const RUN_TRIGGER = "lib/run-trigger-label.ts";

describe("a run row states duration, model and cost", () => {
  const row = code(RUN_ROW);

  it("draws every part the usage line carries", () => {
    // The regression this guards: importing `runUsageParts` and then rendering
    // only `usage.tokens` — which is exactly the pre-fix row.
    expect(row).toContain("runUsageParts");
    expect(row).toMatch(/usage\.tokens/);
    expect(row).toMatch(/usage\.model/);
    expect(row).toMatch(/usage\.cost/);
  });

  it("states the run's length, from the duration helper", () => {
    expect(row).toContain("runDurationLabel");
    expect(row).toMatch(/\{duration \?/);
  });

  it("suppresses the duration when a failure reason is already on the row", () => {
    // Web's branch order (`execution-log-section.tsx:685-692`): reason first,
    // duration only when there is none. The status badge prints the reason, so
    // rendering both would say the same thing twice on one line.
    expect(row).toMatch(/const duration = reason \? null : runDurationLabel\(task\)/);
  });

  it("states the reason through the shared helper, not a second lookup", () => {
    // One decision about "is a reason on screen" — the badge and the duration
    // gate must not each re-derive it from `failure_reason`.
    expect(row).toContain("const reason = runReasonLabel(task, t)");
    expect(row).not.toMatch(/task\.failure_reason/);
  });

  it("re-prices on a saved custom rate", () => {
    // `summarizeTaskUsage` reads the override store imperatively, so a row
    // without the subscription keeps a pre-override price forever
    // (`lib/custom-pricing-wiring.test.ts` pins the same rule elsewhere).
    expect(row).toContain("useCustomPricingStore((s) => s.pricings)");
    expect(row).toMatch(/runUsageParts\(summarizeTaskUsage\(task\.usage\)\)[\s\S]*?\[task\.usage, pricings\]/);
  });

  it("renders an em dash rather than a zero for a run with no usage", () => {
    // A run from before usage reporting existed was not free. The helpers
    // return null and the row draws "—"; a `usage?.cost ?? "$0.00"` here would
    // claim a figure the client does not have.
    expect(row).not.toMatch(/\$0\.00/);
    expect(row).toMatch(/usage \? usage\.cost : "—"/);
    expect(row).toMatch(/usage \? usage\.tokens : "—"/);
  });

  it("keeps every stated fact visible, not behind a tooltip", () => {
    // A phone has no hover. Web's `rowTitle` carries time/model because a
    // desktop can reach it; anything only in a `title` prop here would be
    // unreachable content (`run-timeline-panel.tsx` records the same call).
    expect(row).not.toMatch(/title=\{[^}]*usage/);
  });
});

describe("a wakeup run names its source", () => {
  const row = code(RUN_ROW);
  const wakeup = code(RUN_WAKEUP);

  it("judges on wakeup_id, not on the summary's wording", () => {
    // A summary is free text in the author's language; matching「唤醒」in it
    // would break the moment a workspace switches locale or a member types the
    // word themselves.
    expect(row).toMatch(/task\.wakeup_id/);
    expect(row).toMatch(/wakeupRunLabel/);
    expect(row).toContain("runTriggerLabel");
  });

  it("reads the rule from the issue's shared cache, gated on there being one", () => {
    // One request per ISSUE, not per row: `select` narrows a query the wakeup
    // section already holds, and `enabled` keeps an ordinary run from arming
    // the read at all.
    expect(wakeup).toContain("issueWakeupsOptions");
    expect(wakeup).toMatch(/select/);
    expect(wakeup).toMatch(/enabled: !!wsId && !!issueId && !!wakeupId/);
    // The per-row mistake: a hand-built key of its own.
    expect(wakeup).not.toMatch(/queryKey:\s*\[[^\]]*wakeupId/);
    // The subtler per-row mistake: spreading the SAME shared options but
    // pointing them at the rule id, which silently turns one cached list into
    // one read per distinct rule.
    expect(wakeup).toMatch(/issueWakeupsOptions\(wsId, issueId \?\? ""\)/);
    expect(wakeup).not.toMatch(/issueWakeupsOptions\(\s*wsId,\s*wakeupId/);
  });

  it("resolves the rule against the screen's issue, end to end", () => {
    // Each link is asserted above on its own; this pins the CHAIN, because the
    // day list is a second surface that has to receive the id — a sheet that
    // stopped threading it would leave that surface unable to resolve a rule
    // while every other assertion still passed.
    expect(row).toContain("useRunWakeup(issueId, task.wakeup_id)");
    // Anchored on the element's own props rather than a lazy span: a
    // `<RunTimelinePanel …>` on one line and an unrelated `issueId={id}` on a
    // later `<RunRow>` would otherwise satisfy a `[\s\S]*?` match.
    expect(code("app/(app)/[workspace]/issue/[id]/runs.tsx")).toMatch(
      /<RunTimelinePanel[^>]*issueId=\{id\}/,
    );
    const panel = code("components/issue/run-timeline-panel.tsx");
    expect(panel).toMatch(/<RunDayList[^>]*issueId=\{issueId\}/);
    expect(panel).toMatch(/<RunListRow[^>]*issueId=\{issueId\}/);
  });

  it("uses the issue the screen is showing, not the task's own field", () => {
    // The cache is keyed by the issue the sheet is open on; resolving a
    // different issue's rules would be worse than showing none.
    expect(row).toMatch(/useRunWakeup\(issueId, task\.wakeup_id\)/);
  });

  it("assembles the condition text from the shared bundle", () => {
    // Two bundles would be two chances to omit `statusLabel`, and a condition
    // mentioning a status would then print `in_review` in one surface and
    // "In Review" in the other.
    expect(row).toContain('useWakeupText');
    const shared = code("lib/use-wakeup-text.ts");
    // Every dep a condition sentence can reach. Each is named on its own line
    // so dropping one is a visible edit rather than a silently shorter object:
    // `statusLabel` → a status condition prints its raw key; `labelName` /
    // `property` → a label or property condition prints the "unknown" fallback
    // for a value the workspace does have; `actorName` → the assignee slot
    // loses the read-state decision (MYS-2228).
    expect(shared).toContain("      statusLabel,\n");
    expect(shared).toContain("labelName:");
    expect(shared).toContain("property:");
    expect(shared).toContain("actorName:");
  });

  it("names both places a wakeup run is listed", () => {
    // Web threads `RunTriggerLabel` through three run surfaces
    // (`execution-log-section.tsx:581`/`:704` and
    // `issue-runs-cumulative-chart.tsx:404`/`:432`). Mobile has exactly two —
    // the runs sheet's rows and the timeline's day list — and a run must not
    // read one way in one and another way in the other.
    const panel = code("components/issue/run-timeline-panel.tsx");
    for (const site of [row, panel]) {
      expect(site).toContain("wakeupRunLabel");
      expect(site).toContain("useRunWakeup");
    }
    // And each of them uses the RESULT, not just the helper: a site that
    // computed the label and drew the pre-fix string is the defect this round
    // exists to remove.
    expect(panel).toMatch(/\{summary\}/);
    expect(row).toMatch(/\{summary\}/);
    expect(panel).toContain(
      "task.wakeup_id\n    ? wakeupRunLabel(text, rule, fallbackSummary)\n    : fallbackSummary",
    );
  });

  it("arms the catalog reads only on a wakeup run's row", () => {
    // Both run surfaces mount per ROW, and `useWakeupText` holds two catalog
    // queries (labels + properties). Called unconditionally on an issue with
    // 1,800 runs that is 3,600 query observers for data only the wakeup rows
    // can draw, so the flag must be driven by the run itself — not left at the
    // default `true`.
    for (const rel of [RUN_ROW, "components/issue/run-timeline-panel.tsx"]) {
      const src = code(rel);
      expect(src, rel).toContain("useWakeupText(!!task.wakeup_id)");
      expect(src, rel).not.toMatch(/useWakeupText\(\s*\)/);
    }
    // The default stays `true` so a surface that always draws a condition (the
    // issue's wakeup section) does not have to opt in.
    expect(code("lib/use-wakeup-text.ts")).toContain(
      "export function useWakeupText(catalogs = true)",
    );
  });

  it("still labels a run whose rule was deleted, or is not read yet", () => {
    // `wakeupRunLabel(deps, undefined, fallback)` returns the fallback
    // unchanged — asserted numerically in `lib/run-trigger-label.test.ts`.
    // What this pins is that the row passes a real fallback rather than
    // building the label itself.
    expect(row).toMatch(
      /wakeupRunLabel\(text, rule, fallbackSummaryText\)/,
    );
    expect(row).toMatch(/runTriggerLabel\(task, t\)/);
  });
});

describe("the shared modules own the rules, not the components", () => {
  it("keeps the model-shortening rule in one place", () => {
    // Two copies is how the same run starts reading as "Opus 5.5" in the sheet
    // and "claude-opus-5-5" in the chart.
    expect(code(RUN_ROW_META)).toContain("export function shortModelName");
    expect(code(RUN_ROW_META)).toMatch(/return model;/);
  });

  it("keeps the outcome vocabulary in one place", () => {
    expect(code(RUN_TRIGGER)).toContain("export function kindLabel");
    expect(code(RUN_TRIGGER)).toContain("export function runTriggerLabel");
    // The row's inline copy of the kind switch is gone; the helper owns it.
    expect(code(RUN_ROW)).not.toMatch(/function fallbackSummary/);
  });
});
