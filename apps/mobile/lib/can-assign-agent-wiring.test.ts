/**
 * Wiring guard for the agent-permission rule (MYS-2550).
 *
 * The defect was two-layered, so this file pins both layers:
 *
 *   1. `lib/can-assign-agent.ts` answered a DIFFERENT question than the server
 *      — it read the derived `visibility` field instead of the authoritative
 *      `permission_mode` + `invocation_targets`. Its own behaviour is pinned in
 *      `can-assign-agent.test.ts`, and its agreement with web in
 *      `can-assign-agent-parity.test.ts`.
 *   2. The issue assignee picker consulted NO permission gate at all. A correct
 *      helper nobody calls is exactly the failure mode this repo has been bitten
 *      by before, so the call itself is asserted here.
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so this asserts on the constructs that carry the behaviour: which
 * helper each surface routes through, and which fields that helper reads.
 * Comments are stripped first so a comment quoting a call cannot satisfy an
 * assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

const RULE = "lib/can-assign-agent.ts";
const PICKER = "components/issue/pickers/assignee-picker-body.tsx";
const CHAT = "app/(app)/[workspace]/(tabs)/chat.tsx";
const AGENT_PAGE = "components/agent/agent-primary-actions.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the permission rule reads the authoritative fields", () => {
  const rule = code(RULE);

  it("judges on permission_mode and invocation_targets", () => {
    expect(rule).toContain("permission_mode");
    expect(rule).toContain("invocation_targets");
  });

  it("never reads the derived visibility field", () => {
    // The regression itself. `visibility` is a lossy projection the backend
    // recomputes per response, so any read of it here re-introduces the wrong
    // answer in at least one direction.
    expect(rule).not.toMatch(/\.visibility\b/);
  });

  it("has no admin bypass on private mode", () => {
    // The old rule returned true for owner/admin on a private agent. The
    // server has no such bypass (`canInvokeAgent`).
    expect(rule).not.toMatch(/role\s*===\s*"admin"[\s\S]{0,80}return true/);
  });
});

describe("every surface that answers 'can I use this agent' routes through it", () => {
  it("the issue assignee picker gates its rows", () => {
    const picker = code(PICKER);
    expect(picker).toContain("assigneeRowBlock(");
    expect(picker).toMatch(/^\s*userId,/m);
    expect(picker).toMatch(/^\s*role,$/m);
    // The gate must drive `disabled`, not merely decorate the row.
    expect(picker).toMatch(/disabled=\{blocked\}/);
  });

  it("the chat agent picker and the agent page still call the rule", () => {
    expect(code(CHAT)).toContain("canAssignAgent(");
    expect(code(AGENT_PAGE)).toContain("canAssignAgent(");
  });
});
