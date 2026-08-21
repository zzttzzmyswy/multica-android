/**
 * Effective agent access-scope derivation — infinite bridge of web
 * `agent_access_test.go` semantics via `packages/core/agents/effective-access.ts`
 * (iteration-84, A8). Covers the three-state mapping and the bulk-Apply gate.
 */
import { describe, expect, it } from "vitest";
import type { AgentInvocationTarget } from "@multica/core/types";
import {
  ALL_ACCESS_SCOPES,
  effectiveAccessScope,
  isAccessChangeReady,
} from "./agent-access";

const workspace = (id = "ws-1"): AgentInvocationTarget =>
  ({ target_type: "workspace", target_id: id });
const member = (id = "user-1"): AgentInvocationTarget =>
  ({ target_type: "member", target_id: id });
const team = (id = "team-1"): AgentInvocationTarget =>
  ({ target_type: "team", target_id: id });

describe("effectiveAccessScope", () => {
  it("maps private permission_mode to owner-only", () => {
    expect(effectiveAccessScope("private", [workspace()])).toBe("owner-only");
  });

  it("maps public_to with a workspace target to workspace", () => {
    expect(effectiveAccessScope("public_to", [workspace()])).toBe("workspace");
  });

  it("maps public_to with only member/team targets to specific-people", () => {
    expect(effectiveAccessScope("public_to", [member(), team()])).toBe(
      "specific-people",
    );
  });

  it("maps public_to with no targets to specific-people (absent targets)", () => {
    expect(effectiveAccessScope("public_to", null)).toBe("specific-people");
    expect(effectiveAccessScope("public_to", undefined)).toBe("specific-people");
    expect(effectiveAccessScope("public_to", [])).toBe("specific-people");
  });

  it("fails safe to owner-only when permission_mode is absent", () => {
    expect(effectiveAccessScope(undefined, [workspace()])).toBe("owner-only");
    expect(effectiveAccessScope(null, [member()])).toBe("owner-only");
  });

  it("treats an unknown string mode as non-public_to", () => {
    expect(
      effectiveAccessScope("weird" as never, [workspace()]),
    ).toBe("owner-only");
  });

  it("exposes the display-order list", () => {
    expect([...ALL_ACCESS_SCOPES]).toEqual([
      "workspace",
      "specific-people",
      "owner-only",
    ]);
  });
});

describe("isAccessChangeReady", () => {
  it("is false for no selection (null)", () => {
    expect(isAccessChangeReady(null)).toBe(false);
  });

  it("is true for a private change with zero targets", () => {
    expect(isAccessChangeReady({ permission_mode: "private", invocation_targets: [] })).toBe(
      true,
    );
  });

  it("is true for public_to with targets", () => {
    expect(
      isAccessChangeReady({ permission_mode: "public_to", invocation_targets: [workspace()] }),
    ).toBe(true);
  });

  it("is false for public_to with zero targets", () => {
    expect(
      isAccessChangeReady({ permission_mode: "public_to", invocation_targets: [] }),
    ).toBe(false);
  });
});