/**
 * Wiring ratchet for iteration 288 (MYS-2625) — the project workflow has to
 * reach the WRITE surfaces, not only the resolver.
 *
 * The pure suites prove `resolveStatusScope` / `workflowStatusOptions` decide
 * the right option list, and that `workflowRefusalCopy` words the two refusals.
 * They prove nothing about whether the picker, the board card and the swimlane
 * card actually pass an issue's project in, or whether the alert channel wires
 * the refusal at all. That gap is the exact shape of the defect this round
 * removes: mobile carried a status catalog that was correct in isolation while
 * every entry point offered it unfiltered.
 *
 * Comments are stripped before matching, so a comment DESCRIBING a call site
 * cannot satisfy an assertion about it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * The surfaces that RESOLVE the option list themselves, rather than receiving
 * it from a parent. Each is a place the phone can offer a status the server
 * refuses, so each must read a scoped set.
 */
const OPTION_RESOLVING_SURFACES = [
  "components/issue/board-view.tsx",
  "components/issue/swimlane-view.tsx",
];

describe("every status-write surface is workflow-scoped", () => {
  for (const rel of OPTION_RESOLVING_SURFACES) {
    it(`${rel} reads its options from useIssueStatusOptions`, () => {
      // `useStatusOptions` is the whole catalog. Using it on a write surface is
      // the original defect in one line, so the assertion is deliberately
      // negative as well as positive.
      const src = code(rel);
      expect(src).toContain("useIssueStatusOptions");
      expect(src).not.toContain("useStatusOptions(");
    });

    it(`${rel} passes a project id, not nothing`, () => {
      // `undefined` means "this surface spans projects" and lifts the limit —
      // so a write surface must pass SOMETHING derived from the issue.
      const src = code(rel);
      expect(src).toMatch(/useIssueStatusOptions\(\s*wsId\s*,\s*issue\.project_id\s*,/);
    });
  }

  it("the picker body receives the project from its route", () => {
    const body = code("components/issue/pickers/status-picker-body.tsx");
    // The prop must exist and be forwarded into the hook, or the route below
    // has nowhere to put the project id and silently falls back to `undefined`.
    expect(body).toMatch(/projectId\??:\s*string\s*\|\s*null/);
    expect(body).toMatch(/useIssueStatusOptions\(\s*wsId\s*,\s*projectId\s*,/);
  });

  /**
   * The hooks must actually USE the resolver.
   *
   * Measured gap, not a hypothetical: replacing `workflowStatusOptions(…)` with
   * the raw `catalog.options` inside `useIssueStatusOptions` — i.e. restoring
   * the original defect exactly — left every test green, because the pure suite
   * exercises the resolver directly and nothing asserted the hook calls it.
   * The resolver being correct says nothing about whether anyone asks it.
   */
  it("useIssueStatusOptions builds its list through workflowStatusOptions", () => {
    const src = code("lib/status-options.ts");
    const hookStart = src.indexOf("export function useIssueStatusOptions");
    expect(hookStart).toBeGreaterThan(-1);
    const hook = src.slice(hookStart);
    expect(hook).toContain("resolveStatusScope(");
    expect(hook).toContain("workflowStatusOptions(");
    // …and feeds it the catalog, not a hard-coded or empty list.
    expect(hook).toMatch(/workflowStatusOptions\(\s*catalog\.options\s*,/);
  });

  it("the plain catalog hook is still what the FILTER reads", () => {
    // The filter spans projects by definition, so narrowing it to one issue's
    // workflow would make issues unfindable — the mirror-image bug. Keeping the
    // two hooks distinct is the point; this pins that `status-options.ts` still
    // exports the unscoped one for those callers.
    const src = code("lib/status-options.ts");
    expect(src).toContain("export function useStatusOptions(");
  });

  it("the issue picker route forwards the issue's own project", () => {
    const route = code("app/(app)/[workspace]/issue/[id]/picker/status.tsx");
    // `issue.project_id` may be null (outside any project), and null must
    // reach the hook — coalescing it to `undefined` would lift the limit.
    expect(route).toContain("projectId={");
    expect(route).toContain("issue.project_id");
    expect(route).not.toMatch(/projectId=\{[^}]*\?\?/);
  });
});

describe("the alert channel reports workflow refusals", () => {
  const client = code("data/query-client.ts");

  it("wires workflowRefusalCopy into the mutation error handler", () => {
    // Without this, a refusal reaches the user as the generic title plus the
    // server's agent-facing body — the symptom this round removes.
    expect(client).toContain("workflowRefusalCopy");
  });

  it("labels the refusal's statuses from the workspace catalog", () => {
    // `allowed_statuses` arrives as raw keys; rendering them unlabelled puts
    // `in_progress` on a Chinese screen.
    expect(client).toContain("alertStatusLabelFromCache");
  });

  it("takes the refusal OFF the generic path instead of stacking copy", () => {
    // Ordering matters: the refusal must be offered before the generic title,
    // and a refusal must RETURN rather than fall through to it.
    const src = code("lib/write-failure.ts");
    const handlerStart = src.indexOf("export function reportWriteFailure");
    expect(handlerStart).toBeGreaterThan(-1);
    const handler = src.slice(handlerStart);
    const refusal = handler.indexOf("workflowRefusal?.()");
    const genericTitle = handler.indexOf("writeFailureTitleKey(mutation)");
    expect(refusal).toBeGreaterThan(-1);
    expect(genericTitle).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(genericTitle);
  });
});
