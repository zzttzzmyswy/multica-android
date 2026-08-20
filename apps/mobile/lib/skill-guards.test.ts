/**
 * Pure-function tests for skill permission + origin helpers. Mirrors the web
 * semantics in packages/views/skills/hooks/use-can-edit-skill.ts and
 * packages/views/skills/lib/origin.ts so the mobile UI gates actions with the
 * same rules the server enforces on its own.
 */
import { describe, expect, it } from "vitest";
import {
  canEditSkill,
  isRefreshableOrigin,
  ORIGIN_LABEL_KEY,
  readOrigin,
  type OriginInfo,
} from "./skill-guards";

describe("canEditSkill", () => {
  const skill = {
    id: "s1",
    workspace_id: "w1",
    name: "my-skill",
    description: "",
    config: {},
    created_by: "u-creator",
    created_at: "",
    updated_at: "",
  };

  it("admin may edit any skill, even without a creator", () => {
    expect(
      canEditSkill({ ...skill, created_by: null }, { userId: "u-any", role: "admin" }),
    ).toBe(true);
  });

  it("owner may edit any skill", () => {
    expect(
      canEditSkill(skill, { userId: "u-other", role: "owner" }),
    ).toBe(true);
  });

  it("regular member may edit a skill they created", () => {
    expect(
      canEditSkill(skill, { userId: "u-creator", role: "member" }),
    ).toBe(true);
  });

  it("regular member cannot edit a skill someone else created", () => {
    expect(
      canEditSkill(skill, { userId: "u-other", role: "member" }),
    ).toBe(false);
  });

  it("false when the skill is still loading / not found", () => {
    expect(
      canEditSkill(null, { userId: "u-creator", role: "admin" }),
    ).toBe(false);
    expect(
      canEditSkill(undefined, { userId: "u-creator", role: "admin" }),
    ).toBe(false);
  });

  it("conservative while role/userId are unknown (member list not loaded)", () => {
    expect(
      canEditSkill(skill, { userId: null, role: null }),
    ).toBe(false);
    // Unknown role but matching creator: still allowed — creator ownership is
    // independent of the member list, matching web.
    expect(
      canEditSkill(skill, { userId: "u-creator", role: null }),
    ).toBe(true);
  });
});

describe("readOrigin", () => {
  const base = {
    id: "s1",
    workspace_id: "w1",
    name: "n",
    description: "",
    config: {} as Record<string, unknown>,
    created_by: null,
    created_at: "",
    updated_at: "",
  };

  it("returns manual when there is no config.origin", () => {
    expect(readOrigin(base)).toEqual({ type: "manual" });
  });

  it("returns manual for an unknown/absent origin type", () => {
    expect(
      readOrigin({ ...base, config: { origin: { type: "something-else" } } }),
    ).toEqual({ type: "manual" });
  });

  it("returns manual when config.origin is malformed (not an object)", () => {
    expect(
      readOrigin({ ...base, config: { origin: "runtime_local" } }),
    ).toEqual({ type: "manual" });
  });

  it.each(["runtime_local", "clawhub", "skills_sh", "github"] as const)(
    "reads hosted origin type %s",
    (type) => {
      expect(
        readOrigin({ ...base, config: { origin: { type } } }),
      ).toEqual({ type });
    },
  );

  it("carries source_url through when the origin has one", () => {
    expect(
      readOrigin({
        ...base,
        config: { origin: { type: "github", source_url: "https://github.com/a/b" } },
      }),
    ).toEqual({ type: "github", source_url: "https://github.com/a/b" });
  });
});

describe("isRefreshableOrigin", () => {
  const hosted = (source_url?: string): OriginInfo => ({
    type: "github",
    source_url,
  });

  it("true for a hosted origin with a source_url", () => {
    expect(isRefreshableOrigin({ type: "github", source_url: "https://g/x" })).toBe(true);
    expect(isRefreshableOrigin({ type: "skills_sh", source_url: "https://s/x.ts" })).toBe(true);
    expect(isRefreshableOrigin({ type: "clawhub", source_url: "https://c/x" })).toBe(true);
  });

  it("false when source_url is missing or empty", () => {
    expect(isRefreshableOrigin(hosted(undefined))).toBe(false);
    expect(isRefreshableOrigin(hosted(""))).toBe(false);
  });

  it("false for runtime_local and manual origins", () => {
    expect(isRefreshableOrigin({ type: "runtime_local" })).toBe(false);
    expect(isRefreshableOrigin({ type: "manual" })).toBe(false);
  });
});

describe("ORIGIN_LABEL_KEY", () => {
  it("has a label key for every origin type", () => {
    for (const type of ["runtime_local", "clawhub", "skills_sh", "github", "manual"] as const) {
      expect(typeof ORIGIN_LABEL_KEY[type]).toBe("string");
      expect(ORIGIN_LABEL_KEY[type].length).toBeGreaterThan(0);
    }
  });
});