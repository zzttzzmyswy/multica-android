/**
 * Wiring guard for the issue-detail "is an agent working" surfaces.
 *
 * The Node-only test lane cannot render RN components (`vitest.config.ts`), so
 * what is checkable is which source each surface reads and which claim it is
 * allowed to make. That is exactly where this bug lived: the pure decisions
 * were fine in isolation, and two of the three surfaces never asked them.
 *
 * The failure mode being pinned is subtle at runtime — the avatars still
 * appear, the dot still pulses, the words are still English. Only the fact is
 * wrong. Nothing goes red unless a test states which source must be read.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments stripped — every file here carries long comments that
 *  name the very symbols under assertion, so a raw `toContain` would pass on
 *  prose alone and guard nothing. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SURFACES = [
  "components/issue/agent-activity-row.tsx",
  "components/issue/agent-header-badge.tsx",
] as const;

describe("every detail surface routes its claim through the shared decision", () => {
  for (const file of SURFACES) {
    it(`${file} calls summarizeIssueWork`, () => {
      expect(code(file)).toContain("summarizeIssueWork(");
    });

    it(`${file} does not treat a non-empty active list as "working"`, () => {
      // The original defect in one shape: any of these reads the list length
      // as proof of work. `activeCount` was the exact variable in the old
      // activity row.
      const src = code(file);
      expect(src).not.toContain("activeCount");
      expect(src).not.toMatch(/active\.length\s*===\s*0/);
      expect(src).not.toMatch(/active\.length\s*>\s*0/);
      expect(src).not.toMatch(/activeTasks\.length\s*>\s*0/);
    });

    it(`${file} gates the pulse on the running state`, () => {
      // Motion is the claim "work is happening right now". It must be
      // reachable only from the running branch, never rendered unconditionally.
      //
      // The assertion has to be `running ? … : null` (or `running && …`), not
      // merely "the word running appears in this file" — a first cut accepted
      // any line mentioning PulseDot and stayed green when the element was
      // rendered unconditionally. That is the mutation this pins.
      const src = code(file);
      const pulseLines = src
        .split("\n")
        .filter((line) => line.includes("<PulseDot"));
      expect(pulseLines).toHaveLength(1);
      expect(pulseLines[0]).toMatch(
        /running\s*\?\s*<PulseDot[^;]*:\s*null|running\s*&&\s*<PulseDot/,
      );
      // and that condition must be the state, not a bare length check
      expect(src).toContain('work.state === "running"');
    });
  }

  it("the activity row says queued rather than working when nothing started", () => {
    const src = code("components/issue/agent-activity-row.tsx");
    // Both branches must exist and be distinct keys: one key for both states
    // is the bug, and it would still typecheck.
    expect(src).toContain('t("issue.working")');
    // The count is pluralized explicitly — `translate()` does no plural
    // resolution, so a bare `issue.queuedAgents` would resolve to nothing and
    // the locale-completeness harness rightly rejects it. `countLabelKey` picks
    // `_one` / `_other`, the same helper every other count label uses.
    expect(src).toContain('countLabelKey("issue.queuedAgents"');
  });

  it("the header badge announces the queued state, not only the working one", () => {
    const src = code("components/issue/agent-header-badge.tsx");
    expect(src).toContain('t("a11y.agentWorking")');
    expect(src).toContain('countLabelKey("a11y.agentQueued"');
  });
});

describe("the issue-work-state module stays the single definition", () => {
  it("no surface re-derives the status split locally", () => {
    // A local `status === "running"` test in a surface means the definition
    // has forked again — the exact regression this module exists to prevent.
    for (const file of SURFACES) {
      const src = code(file);
      expect(src).not.toContain('status === "running"');
      expect(src).not.toContain('status === "queued"');
    }
  });

  it("the third surface (row indicator) reads the shared core projection", () => {
    // It was already correct; asserting it keeps a future edit from replacing
    // the shared projection with a local length check.
    const src = code("components/issue/issue-agent-activity-indicator.tsx");
    expect(src).toContain("summarizeIssueActivity(");
    expect(src).toContain("selectIssueTasks(");
  });
});
