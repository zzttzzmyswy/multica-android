import { readFileSync } from "node:fs";
import path from "node:path";
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
 * Wiring guards for iteration 225 (MYS-2084) — the issue's run timeline.
 *
 * The pure layer is covered by `lib/issue-run-timeline.test.ts`; what a unit
 * test cannot see is whether the page actually USES it. Three properties the
 * issue states by name and that only the source can be asked about:
 *
 *  1. the strip and the full chart are fed by ONE `buildRunTimeline` call, so
 *     "总花费 / 智能体工作 / 历时 / 运行次数" and the curve's end reading cannot
 *     each be computed their own way;
 *  2. every priced figure flows through `lib/task-usage.ts` — no second price
 *     formula in the timeline;
 *  3. no new network round trip: the sheet still reads only the two queries it
 *     already had.
 */
const APP_ROOT = path.resolve(__dirname, "..");

function read(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8");
}

const ROUTE = "app/(app)/[workspace]/issue/[id]/runs.tsx";
const PANEL = "components/issue/run-timeline-panel.tsx";

describe("run timeline wiring", () => {
  it("fixture sanity: both files exist and are non-trivial", () => {
    expect(read(ROUTE).length).toBeGreaterThan(2000);
    expect(read(PANEL).length).toBeGreaterThan(8000);
  });

  it("builds the timeline once in the route and hands it to both surfaces", () => {
    const route = read(ROUTE);
    // Exactly one call site: a second would be a second place for the two
    // surfaces to drift apart.
    expect(route.match(/buildRunTimeline\(/g) ?? []).toHaveLength(1);
    // The strip and the panel both take the built object, not a task list.
    expect(route).toContain("<RunSpendStrip");
    expect(route).toContain("timeline={timeline}");
    expect(route).toContain("<RunTimelinePanel");
    expect(route).toContain("timeline={timeline}");
  });

  it("prices nothing itself — the cost formula stays in lib/task-usage", () => {
    const route = read(ROUTE);
    const panel = read(PANEL);
    for (const [name, src] of [["route", route], ["panel", panel]] as const) {
      // No re-derivation of a price from tokens anywhere in the timeline.
      expect(src, `${name} must not compute cost from tokens`).not.toMatch(
        /tokens?\s*\*\s*pric/,
      );
      expect(src, `${name} must not inline a per-million rate`).not.toMatch(/1_000_000/);
      expect(src, `${name} must not reach into the rate table`).not.toMatch(/MODEL_PRICING/);
    }
    // The panel's money all arrives through the shared helpers.
    expect(panel).toContain('from "@/lib/task-usage"');
    expect(panel).toContain("formatUsd");
  });

  it("adds no network round trip — only the two task queries the sheet had", () => {
    const route = read(ROUTE);
    const queries = route.match(/useQuery\(/g) ?? [];
    // issueActiveTasksOptions / issueTasksOptions / issueDetailOptions.
    expect(queries).toHaveLength(3);
    expect(route).toContain("issueActiveTasksOptions");
    expect(route).toContain("issueTasksOptions");
    // Nothing timeline-shaped is fetched.
    expect(route).not.toMatch(/fetch\(|api\.(get|post)\(/);
  });

  it("renders an em dash, never $0, for a run with no usage recorded", () => {
    const panel = read(PANEL);
    // The day list's per-run figure.
    expect(panel).toContain('run.usage ? formatUsd(run.usage.cost) : "—"');
    // The stats hero number.
    expect(panel).toContain('timeline.pricedCount > 0 ? formatUsd(timeline.totalCost) : "—"');
    // And the "no figure" phrase for the readout.
    expect(panel).toContain('t("runsTimeline.noUsage")');
    // A `?? 0` on a run's own cost would render $0.00 for an unpriced run.
    expect(panel).not.toMatch(/run\.usage\?\.cost \?\? 0\)\}/);
  });

  it("guards the zero-scale case that crashed the app on-device", () => {
    // Found against MYS-1991: 8 runs, every one with a usage record, every
    // model unpriced — so `pricedCount > 0` lets a curve through with a total
    // of exactly 0. `stepCurvePath` must not divide by that (NaN coordinates
    // make react-native-svg's native path parser throw), and the strip must not
    // either. Both sites carry `hasScale`; this pins that neither loses it.
    const lib = read("lib/issue-run-timeline.ts");
    expect(lib).toMatch(/const hasScale = Number\.isFinite\(yMax\) && yMax > 0;/);
    const panel = read(PANEL);
    // Two scales: the strip's raw-total one and the chart's niceTicks one.
    expect(panel.match(/const hasScale/g) ?? []).toHaveLength(2);
    expect(panel).toContain("const yMax = timeline.totalCost / SPARK_HEADROOM;");
  });

  it("thins x-axis ticks to the phone's plot width", () => {
    // Web asks timeTicks for 8 ticks in a ~1024px dialog. A phone's plot is
    // ~270px, where 5 daily labels collided on-device (MYS-1893). The budget
    // must scale with the measured width rather than being web's constant.
    const panel = read(PANEL);
    expect(panel).toContain("timeTicks(timeline.domain, tickBudget(plotWidth))");
    expect(panel).toContain("const TICK_LABEL_PX");
  });

  it("claims a horizontal drag on the chart so the sheet does not eat it", () => {
    // Plain onTouchStart/Move loses a horizontal drag to the enclosing
    // ScrollView: the crosshair jumped once on touch-start and then stopped
    // (observed on-device). The chart takes the responder for horizontal pans
    // only, so a vertical swipe still scrolls the sheet past it.
    const panel = read(PANEL);
    expect(panel).toContain("PanResponder.create");
    expect(panel).toMatch(
      /onMoveShouldSetPanResponder: \(_e, g\) =>\s*Math\.abs\(g\.dx\) > Math\.abs\(g\.dy\)/,
    );
    expect(panel).not.toMatch(/onTouchStart=\{onTouch\}/);
    // And the responder's own children must not swallow the gesture: the SVG
    // overlay and every lane band sit under it.
    expect(panel.match(/pointerEvents="none"/g) ?? []).toHaveLength(4);
  });

  it("reads the scrub position from pageX, not locationX", () => {
    // `locationX` on this responder reports coordinates relative to whichever
    // DESCENDANT was touched (the SVG overlay, a lane View), and the
    // view-relative value only arrives on grant, not on move — which is why the
    // crosshair did not track the finger on-device. `pageX` is the same number
    // at every level, so one `measureInWindow` anchors it for good.
    const panel = read(PANEL);
    expect(panel).toContain("measureInWindow");
    expect(panel).toMatch(/const scrubTo = \(pageX: number\) => \{\s*const x = pageX - plotLeftRef\.current;/);
    expect(panel).not.toMatch(/scrubTo\(e\.nativeEvent\.locationX\)/);
  });

  it("keeps the scrub readout after the finger lifts", () => {
    // The reader's hand covers the curve during the drag, so a readout that
    // clears on touch-end is unreadable. It must be dismissed by an explicit
    // tap (or by collapsing the timeline), not by the gesture finishing.
    const panel = read(PANEL);
    expect(panel).not.toContain("onTouchEnd");
    expect(panel).toContain('onPress={() => setReadoutX(null)}');
    expect(panel).toContain('t("runsTimeline.clearScrub")');
  });

  it("subscribes to the custom-pricing store so a saved rate repaints", () => {
    // `estimateCost` reads the store imperatively; without this subscription a
    // rate saved on the runtime usage page would leave the curve on the old
    // price until the task query happened to refetch.
    expect(read(ROUTE)).toContain("useCustomPricingStore");
    expect(read(ROUTE)).toMatch(/\[allTasks, pricings, timelineOpen\]/);
  });
});

/**
 * The timeline's copy. Same contract as every keys test in this directory:
 * each key resolves in BOTH locales and the zh value is the exact Chinese copy,
 * taken from web's `runs_timeline` namespace
 * (`packages/views/locales/zh-Hans/issues.json`) so the two clients name the
 * same figures the same way.
 */
describe("run timeline i18n", () => {
  let mod: Awaited<ReturnType<typeof loadI18n>>;

  async function loadI18n() {
    return await import("@/lib/i18n/index");
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mod = await loadI18n();
    mod.resetI18nForTests();
    mod.setLocale("en");
  });

  const ZH_SPOT: Record<string, string> = {
    "runsTimeline.title": "运行记录",
    "runsTimeline.statSpent": "已花费",
    "runsTimeline.statAgentTime": "智能体工作",
    "runsTimeline.statElapsed": "历时",
    "runsTimeline.statRuns": "运行次数",
    "runsTimeline.legendCumulative": "累计费用",
    "runsTimeline.legendRun": "运行 · 宽度为时长",
    "runsTimeline.dayToday": "今天",
    "runsTimeline.dayYesterday": "昨天",
    // The semantic the issue calls out by name: no usage is "no figure", and
    // the copy has to say that rather than imply a zero.
    "runsTimeline.noUsage": "没有用量记录",
    "runsTimeline.sparklineNoUsage": "没有用量记录",
    "runsTimeline.hoverNoRun": "没有运行",
    "runsTimeline.sparklineNow": "现在",
    "runsTimeline.noteEstimate": "费用按各模型公开价目估算；供应商回报实际费用时以回报值为准。",
  };

  it("resolves every timeline key in both locales with the web zh copy", () => {
    for (const [key, zh] of Object.entries(ZH_SPOT)) {
      const en = mod.translate(key);
      expect(en, `${key} missing from en`).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);
      mod.setLocale("zh");
      expect(mod.translate(key), `${key} zh copy`).toBe(zh);
      mod.setLocale("en");
    }
  });

  it("keeps the interpolating keys' placeholders in both locales", () => {
    const withParams: [string, string[]][] = [
      ["runsTimeline.chartAria", ["count", "cost"]],
      ["runsTimeline.countFailed", ["count"]],
      ["runsTimeline.countCancelled", ["count"]],
      ["runsTimeline.countActive", ["count"]],
      ["runsTimeline.dayRuns", ["count"]],
      ["runsTimeline.tooltipTotal", ["cost"]],
      ["runsTimeline.hoverIdle", ["duration"]],
      ["runsTimeline.noteUnmapped", ["models"]],
      ["runsTimeline.quoted", ["text"]],
    ];
    for (const [key, params] of withParams) {
      for (const locale of ["en", "zh"] as const) {
        mod.setLocale(locale);
        const raw = mod.translate(key);
        expect(raw, `${key} (${locale})`).not.toBe(key);
        for (const p of params) {
          expect(raw, `${key} (${locale}) must interpolate {{${p}}}`).toContain(`{{${p}}}`);
        }
        // And it actually substitutes rather than leaving the placeholder.
        const filled = mod.translate(
          key,
          Object.fromEntries(params.map((p) => [p, "X"])),
        );
        expect(filled).not.toContain("{{");
        mod.setLocale("en");
      }
    }
  });

  it("says 'no usage recorded' for a run with no figure, never a zero", () => {
    mod.setLocale("zh");
    // The one string that carries the semantic. An English "0" or a "$0" here
    // would be the defect the issue names.
    for (const key of ["runsTimeline.noUsage", "runsTimeline.sparklineNoUsage"]) {
      const zh = mod.translate(key);
      expect(zh).not.toMatch(/\$?0/);
      expect(zh).toContain("没有用量记录");
    }
    mod.setLocale("en");
  });
});
