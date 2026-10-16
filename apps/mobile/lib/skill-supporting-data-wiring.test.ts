/**
 * Wiring guard for MYS-2192 — the skills surfaces' supporting-data degradation.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts), so a correct
 * `usedByCell` proves nothing about whether the list renders it. The defect
 * this round closes lives entirely at the call site: the decisions were
 * available (both reads were already wrapped in `catalogRead`) and simply were
 * not consumed, so 「未使用」 and the read-only lock were printed from failed
 * requests with no banner anywhere to correct them.
 *
 * Three assertions per surface, because any one alone is passable:
 *
 *   1. the banner gate is wired and its copy comes from the round's key;
 *   2. the cells go through the decision helpers rather than the bare
 *      `length === 0` / `canEdit` shorthand that made the claim;
 *   3. the settlement flags actually reach the row (`buildSkillRows`), which is
 *      what lets a cell know a zero is unread.
 *
 * Comments are stripped before matching, so a comment that quotes the banned
 * construct can neither satisfy nor trip an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");
const LIST = "app/(app)/[workspace]/more/skills.tsx";
const DETAIL = "app/(app)/[workspace]/more/skills/[id].tsx";
const ROWS = "lib/filter-skills.ts";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("skills list — supporting-data degradation", () => {
  const src = code(LIST);

  it("renders the banner under the web gate", () => {
    expect(src).toContain("SupportingDataWarning");
    expect(src).toMatch(
      /supportingDataWarningVisible\(\{\s*agents:\s*agentsRead\.state,\s*members:\s*membersRead\.state,?\s*\}\)/,
    );
    expect(src).toContain('t("skills.list.supportingDataWarning")');
  });

  it("feeds the row's settlement flags from the resolved reads", () => {
    // `buildSkillRows` without these defaults to `true`, which silently
    // restores the pre-fix behaviour: cells assert from a zero that no read
    // produced.
    expect(src).toMatch(/agentsResolved:\s*agentsRead\.isResolved/);
    expect(src).toMatch(/membersResolved:\s*membersRead\.isResolved/);
    // …and the memo must re-run when they change, or a read that fails after
    // the rows were built leaves the cells asserting.
    expect(src).toMatch(/agentsRead\.isResolved,\s*membersRead\.isResolved,/);
  });

  it("decides the lock and the used-by cell instead of asserting them", () => {
    expect(src).toMatch(/skillLockCell\(canEdit,\s*membersResolved\)/);
    expect(src).toMatch(/usedByCell\(agents\.length,\s*resolved\)/);
    // The pre-fix shapes, verbatim. `canEdit ? pencil : lock` is the lock
    // asserted from an unanswered members read; the bare length test is
    // 「未使用」 asserted from an unanswered agents read.
    expect(src).not.toMatch(/\{canEdit \? \(\s*<Ionicons name="pencil"/);
    expect(src).not.toMatch(/if \(agents\.length === 0\) \{\s*return \(\s*<Text[^>]*>\s*\{t\("skills\.list\.unused"\)\}/);
  });

  it("keeps the lock's tooltip text on the lock it still draws", () => {
    // The branch that survives must be the real denial — if the degraded path
    // swallowed the accessibility label too, the lock would lose its only
    // explanation for the users who could hear it.
    expect(src).toContain('accessibilityLabel={t("skills.list.lockTooltip")}');
  });
});

describe("skill detail — supporting-data degradation", () => {
  const src = code(DETAIL);

  it("renders the banner under the web gate, with its own copy", () => {
    expect(src).toContain("SupportingDataWarning");
    expect(src).toMatch(
      /supportingDataWarningVisible\(\{\s*agents:\s*agentsRead\.state,\s*members:\s*membersRead\.state,?\s*\}\)/,
    );
    // Web words the two surfaces differently ("… may appear incomplete" vs
    // "… may appear incomplete until the next refresh"); the phone keeps both
    // keys so the screens do not silently share one string.
    expect(src).toContain('t("skills.detail.supportingDataWarning")');
  });

  it("decides the used-by body instead of claiming an absence", () => {
    expect(src).toMatch(/usedBySection\(\s*usedByAgents\.length,\s*agentsRead\.isResolved,?\s*\)/);
    expect(src).toContain("CatalogStatus");
    expect(src).toMatch(/usedByVerdict === "status"/);
    // The pre-fix shape: the "not assigned yet" panel reached whenever the
    // length was zero, which a failed read also produces.
    expect(src).not.toMatch(/\{usedByAgents\.length === 0 \? \(\s*<View className="rounded-lg border border-dashed/);
  });

  it("gates the header count on the same read as the section below it", () => {
    expect(src).toMatch(/usedByCount\(\s*usedByAgents\.length,\s*agentsRead\.isResolved,?\s*\)/);
    // BOTH count sites — the identity strip's 「被 N 个智能体使用」 and the
    // Used-by section's title — read it, and neither may fall back to the raw
    // length. Mutation testing caught the earlier, weaker version of this
    // assertion: it matched the identity strip alone, so ungating the section
    // title left the guard green.
    expect(src).not.toMatch(/usedByAgents\.length === 1/);
    expect(src).not.toMatch(/count:\s*usedByAgents\.length/);
    expect(src.match(/usedByTotal/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe("buildSkillRows — settlement plumbing", () => {
  const src = code(ROWS);

  it("carries both flags onto every row", () => {
    expect(src).toMatch(/agentsResolved,\s*membersResolved,/);
  });

  it("defaults to settled so unrelated callers are unaffected", () => {
    // `true` is the honest default: a caller that does not track the reads is
    // one whose directories came from a settled source. Defaulting to `false`
    // would hang "unknown" on every row of every other surface.
    expect(src).toMatch(/agentsResolved = true/);
    expect(src).toMatch(/membersResolved = true/);
  });
});
