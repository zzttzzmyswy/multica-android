/**
 * Wiring guard for the restricted-agent lock in the issue assignee picker.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so a correct `isRestrictedAgent` helper that no row calls fixes
 * nothing. Web's picker renders a lock next to every non-workspace agent
 * (packages/views/issues/components/pickers/assignee-picker.tsx); this guard
 * pins that the mobile row does the same, through the shared derivation, and
 * that it does not fall back to the lossy legacy `visibility` field.
 *
 * Matches call syntax after stripping comments, so a comment quoting the call
 * cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This file lives in `lib/`, so one level up is the mobile app root.
const APP_ROOT = path.resolve(__dirname, "..");

const PICKER_BODY = "components/issue/pickers/assignee-picker-body.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("assignee picker restricted-agent lock", () => {
  const src = code(PICKER_BODY);

  it("derives restricted-ness from the shared access-scope helper", () => {
    expect(src).toContain('from "@/lib/agent-list-access"');
    expect(src).toContain("isRestrictedAgent");
  });

  it("gates the lock on that helper, on agent rows only", () => {
    expect(src).toMatch(
      /item\.kind === "agent" && isRestrictedAgent\(item\.agent\)/,
    );
  });

  it("renders the lock icon", () => {
    expect(src).toContain('name="lock-closed-outline"');
  });

  it("keeps the lock out of the row's accessible name", () => {
    // The row's Pressable is the accessible element and takes its name from
    // its text children; an unlabelled icon font glyph would be read out as
    // gibberish. Web's lock is decorative too.
    expect(src).toContain("accessibilityElementsHidden");
  });

  it("never reads the legacy visibility field", () => {
    expect(src).not.toContain(".visibility");
  });
});
