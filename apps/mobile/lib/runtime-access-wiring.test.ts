/**
 * Wiring guard for the three-way runtime access surfaces (MUL-8185).
 *
 * The defect this pins was not a wrong helper — every helper
 * (`runtimeAccessScope`, `runtimeAccessBadge`, `runtimeAccessPatch`) has unit
 * tests in `runtime-access.test.ts`. It was that no surface called them: the
 * detail page had its own two-button private/public editor, and three picker
 * surfaces printed `runtimes.visibility.private` for any non-public runtime,
 * so a machine shared with the viewer read as plain 私有 beside an unlocked
 * row they were allowed to pick.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so this asserts on the constructs that carry the behaviour.
 * Comments are stripped first so a comment quoting a call cannot satisfy an
 * assertion, and the negative assertions are the point: re-deriving
 * `visibility === "public"` at a surface is exactly how the two-state model
 * grew back last time.
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

const DETAIL = "app/(app)/[workspace]/more/runtimes/[id].tsx";
const LIST = "app/(app)/[workspace]/more/runtimes.tsx";
const SHEET = "components/agent/runtime-picker-sheet.tsx";
const EDITOR = "components/runtimes/runtime-access-editor.tsx";

describe("runtime detail renders the three-way access editor", () => {
  const detail = code(DETAIL);

  it("uses the shared editor for owners and the readout for everyone else", () => {
    expect(detail).toContain("RuntimeAccessEditor");
    expect(detail).toContain("RuntimeAccessReadout");
  });

  it("no longer carries its own private/public flip", () => {
    // The two-button editor and the PATCH it issued are what made "members"
    // unreachable from the phone.
    expect(detail).not.toContain("flipVisibility");
    expect(detail).not.toMatch(/patch:\s*\{\s*visibility:/);
  });
});

describe("runtime rows badge the shared scope", () => {
  const list = code(LIST);

  it("derives the chip from runtimeAccessBadge", () => {
    expect(list).toContain("runtimeAccessBadge(");
  });

  it("does not re-derive public from the raw field", () => {
    // Both the machine header and the row previously compared
    // `visibility === "public"` directly; a third scope cannot fit in that.
    expect(list).not.toMatch(/visibility\s*===\s*"public"/);
  });
});

describe("runtime pickers name the scope instead of guessing private", () => {
  for (const rel of [
    SHEET,
    "components/agent/manual-agent-form.tsx",
    "app/(app)/[workspace]/more/agents/new/ai.tsx",
  ]) {
    it(`${rel} reads the scope through the shared helper`, () => {
      const src = code(rel);
      expect(src).toContain("runtimeAccessScope(");
      // The exact shape that mislabelled a granted member's machine.
      expect(src).not.toMatch(
        /visibility\s*!==\s*"public"[\s\S]{0,120}runtimes\.visibility\.private/,
      );
    });
  }
});

describe("the access editor never submits on a draft boundary", () => {
  const editor = code(EDITOR);

  it("builds every PATCH body through runtimeAccessPatch", () => {
    // Hand-rolling `{ visibility, shared_with }` at a call site is how a
    // public-plus-grants 400 gets shipped: the server rejects that pair, and
    // only the helper keeps them consistent.
    expect(editor).toContain("runtimeAccessPatch(");
    expect(editor).not.toMatch(/patch:\s*\{\s*visibility:/);
  });

  it("parses the 409 plan through the fail-closed helper", () => {
    expect(editor).toContain("parseRuntimeAccessRevocationPlan(");
  });
});
