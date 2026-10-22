import { describe, expect, it, vi } from "vitest";

/**
 * Colour parity for the two priority icons.
 *
 * Upstream MUL-8155 gave High its own `--priority-high` token (oklch(0.68 0.18
 * 50) in light, 0.72 0.17 50 in dark) because High and Medium previously drew
 * the SAME yellow: on a list where the only difference between two rows is one
 * filled bar, "urgent-ish" and "normal" read alike. Web/desktop point
 * `PRIORITY_CONFIG.high` and `PROJECT_PRIORITY_CONFIG.high` at it; the mobile
 * icons mirror those maps as hex.
 *
 * The icons take their colour from a module-private `COLOR` map, and rendering
 * react-native-svg in Node is a poor trade for what this asserts. Reading the
 * source is the honest way to pin the map: the assertion below fails on any
 * value change, including a well-meaning "keep them consistent" revert.
 */
vi.mock("react-native-svg", () => ({
  default: () => null,
  Svg: () => null,
  Line: () => null,
  Rect: () => null,
}));
vi.mock("@/lib/project-status", () => ({
  projectPriorityBars: () => 3,
}));

const src = (rel: string): string =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("node:fs").readFileSync(
    require("node:path").join(__dirname, rel),
    "utf8",
  ) as string;

const ISSUE_ICON = src("../components/ui/priority-icon.tsx");
const PROJECT_ICON = src("../components/ui/project-priority-icon.tsx");

/** Pull `key: "#rrggbb"` out of a named map in the source. */
function colorOf(source: string, priority: string): string | null {
  const match = source.match(
    new RegExp(`\\b${priority}:\\s*"(#[0-9a-fA-F]{6})"`),
  );
  return match ? match[1].toLowerCase() : null;
}

describe("issue PriorityIcon colours", () => {
  it("gives High its own colour, distinct from Medium", () => {
    // The whole point of the upstream change: these two were `#eab308` each.
    expect(colorOf(ISSUE_ICON, "high")).not.toBe(colorOf(ISSUE_ICON, "medium"));
  });

  it("uses the priority-high orange for High", () => {
    // `#f97316` is the hex upstream put in this exact file; pin it so a
    // "consistency" pass cannot fold it back into warning yellow.
    expect(colorOf(ISSUE_ICON, "high")).toBe("#f97316");
  });

  it("keeps Medium on the warning yellow", () => {
    // Only High was split out — Medium is still "normal" and must not turn
    // orange too, or the two would merely swap places.
    expect(colorOf(ISSUE_ICON, "medium")).toBe("#eab308");
  });

  it("leaves urgent, low and none alone", () => {
    expect(colorOf(ISSUE_ICON, "urgent")).toBe("#dc2626");
    expect(colorOf(ISSUE_ICON, "low")).toBe("#3b82f6");
    expect(colorOf(ISSUE_ICON, "none")).toBe("#71717a");
  });

  it("does not fall back to a token class name", () => {
    // The mobile icon paints SVG `fill`, which cannot take a Tailwind class —
    // the hex map is the only mechanism here.
    expect(ISSUE_ICON).not.toMatch(/text-priority-high/);
    expect(colorOf(ISSUE_ICON, "high")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("project ProjectPriorityIcon colours", () => {
  it("uses the same High orange as the issue icon", () => {
    // `PROJECT_PRIORITY_CONFIG` upstream got the identical change, so the two
    // surfaces must agree — a project row and an issue row with the same
    // priority have to look the same.
    expect(colorOf(PROJECT_ICON, "high")).toBe(colorOf(ISSUE_ICON, "high"));
  });

  it("gives project High its own colour, distinct from Medium", () => {
    expect(colorOf(PROJECT_ICON, "high")).not.toBe(colorOf(PROJECT_ICON, "medium"));
  });

  it("keeps every other project priority aligned with the issue icon", () => {
    for (const priority of ["urgent", "medium", "low", "none"]) {
      expect(colorOf(PROJECT_ICON, priority)).toBe(colorOf(ISSUE_ICON, priority));
    }
  });
});

describe("unrelated warning colours were not swept up", () => {
  it("status in_progress is still warning yellow", () => {
    // `in_progress` is a STATUS, not a priority — upstream did not change it,
    // and "everything yellow becomes orange" would repaint the whole app.
    const statusIcon = src("../components/ui/status-icon.tsx");
    expect(statusIcon).toMatch(/in_progress:\s*"#eab308"/);
  });
});
