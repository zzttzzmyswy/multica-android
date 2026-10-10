/**
 * Wiring guard for the two agents-working affordances (iteration 221).
 *
 * The gap this pins: mobile carried the `workingOnly` PREDICATE and the filter
 * sheet could toggle it, but no surface header rendered a chip — so on the
 * phone the feature was invisible unless you opened the sheet and scrolled to
 * a boolean row. The sub-issues header had nothing at all. Both are web
 * surfaces (`issues-header.tsx:1066`, `my-issues-header.tsx:167`,
 * `issue-detail.tsx:2801`), so both are parity gaps rather than preferences.
 *
 * A component test cannot see this: the mobile vitest lane is Node-only and
 * renders no RN components (`vitest.config.ts`). What CAN be checked is that
 * the surfaces are wired to the right sources — and the failure mode this
 * guards is precisely a surface that renders a chip fed by the wrong data (or
 * by the right data through the wrong scope), which is invisible at runtime
 * because the number still renders, just wrongly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments removed — an assertion must match real code, and every
 *  file here carries long comments naming the very symbols being asserted. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SURFACES = [
  ["app/(app)/[workspace]/more/issues.tsx", "all"],
  ["app/(app)/[workspace]/(tabs)/my-issues.tsx", "my"],
] as const;

describe("the issue-surface headers expose the agents-working toggle", () => {
  for (const [file] of SURFACES) {
    it(`${file} renders the chip row`, () => {
      const src = code(file);
      expect(src).toContain("<IssueSurfaceAgentActivityRow");
      expect(src).toContain("IssueSurfaceAgentActivityRow,");
    });

    it(`${file} feeds it the surface's own facet, not a workspace tally`, () => {
      const src = code(file);
      expect(src).toContain("workingAgentsFacetOptions(wsId, workingAgentsQuery)");
      expect(src).toContain("agents={headerWorkingAgents}");
      // The count must be the SERVER's, narrowed like the rows. A client tally
      // over the loaded page would under-report on any workspace bigger than
      // one page — the same defect the group headers were fixed for.
      expect(src).not.toContain("runningIssueIds.size");
    });

    it(`${file} toggles the store field its rows read`, () => {
      const src = code(file);
      expect(src).toContain("value={workingOnly}");
      expect(src).toContain("toggleWorkingOnly()");
    });
  }

  it("builds the chip's window WITHOUT the working dimension", () => {
    // The chip's number must not flicker when the chip is clicked. Its window
    // is the plain one, so flipping the toggle cannot re-key the request —
    // `workingAgentsFacetOptions` strips the dimension as a second guard (see
    // its own test). This asserts the callers pass the plain window rather
    // than reaching for the narrowed `countWindow` sitting right beside it.
    for (const [file] of SURFACES) {
      const src = code(file);
      const block = src.slice(
        src.indexOf("const workingAgentsQuery = useMemo("),
        src.indexOf("const { data: headerWorkingAgents }"),
      );
      expect(block).toContain("window,");
      expect(block).not.toContain("countWindow");
    }
  });
});

describe("the project surface does NOT expose it", () => {
  it("keeps the toggle off the surface whose rows ignore it", () => {
    // Web renders the project page's IssueSurface with no agents-working chip,
    // and mobile's project store hard-codes `workingOnly: false` for its rows
    // (lib/issue-table-group-counts.ts documents the same clamp for its
    // counts). A chip there would advertise a filter the rows below it ignore.
    const src = code("components/project/project-issue-surface.tsx");
    expect(src).not.toContain("IssueSurfaceAgentActivityRow");
    expect(src).not.toContain("workingAgentsFacetOptions");
  });
});

describe("the roster body keeps all three projection states", () => {
  it("renders a distinct body for unresolved and for resolved-empty", () => {
    // These are the two states that keep collapsing into each other across
    // this feature's history. They live in a component the Node-only test lane
    // cannot render, so the guard is on the source — the same technique
    // `issue-working-count-parity.test.ts` uses for its surface wiring. Each
    // branch must name its OWN key: sharing one would make an unresolved
    // projection assert "nobody is working" (MUL-5525).
    const src = code("components/issue/working-agents-roster.tsx");
    expect(src).toContain('t("issue.agentsWorkingUnknown")');
    expect(src).toContain('t("issue.agentsWorkingNone")');
    // The two branches must be distinct — one `if` for each state.
    expect(src).toContain("if (agents === undefined) {");
    expect(src).toContain("if (agents.length === 0) {");
  });

  it("labels the per-agent count through the plural picker", () => {
    const src = code("components/issue/working-agents-roster.tsx");
    expect(src).toContain('countLabelKey("issue.agentsWorkingTasks"');
  });
});

describe("the header chip never renders a zero for an unresolved read", () => {
  it("falls back to the em-dash label, not to 0", () => {
    // "0" and "not known yet" are different claims; rendering one as the other
    // is the defect this whole state machine exists to prevent.
    const src = code("components/issue/agents-working-chip.tsx");
    expect(src).toContain('activity === "unknown"');
    expect(src).toContain('t("issue.agentsWorkingUnknownShort")');
  });

  it("renders the avatar stack only when activity is confirmed", () => {
    const src = code("components/issue/agents-working-chip.tsx");
    expect(src).toContain('activity === "some"');
  });
});

describe("the sub-issues header aggregates over the parent", () => {
  it("mounts the chip in the sub-issues header", () => {
    const src = code("components/issue/issue-children-section.tsx");
    expect(src).toContain("<SubIssuesWorkingChip parentIssueId={issueId} />");
  });

  it("reads the parent-scoped projection, not the task snapshot", () => {
    // Web's reason, carried over: a header count is a claim about a scope, so
    // the server owns the scope AND the arithmetic. Deriving it from the task
    // snapshot would put a second definition of "working" in the client, and
    // the count and the roster would each re-derive it.
    const src = code("components/issue/sub-issues-working-chip.tsx");
    expect(src).toContain("subIssuesWorkingAgentsOptions(wsId, parentIssueId)");
    expect(src).not.toContain("agentTaskSnapshotOptions");
  });

  it("renders nothing when nobody is working, so an idle parent has no chrome",
    () => {
      const src = code("components/issue/sub-issues-working-chip.tsx");
      expect(src).toContain("if (!agents || agents.length === 0) return null;");
    });
});
