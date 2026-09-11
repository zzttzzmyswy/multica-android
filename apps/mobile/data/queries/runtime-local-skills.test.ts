/**
 * Pure state-flow tests for the agent Skills section (web skills-tab
 * parity, MYS-1020): runtime-local-skill disablement matching — the same
 * logic the toggle switches render from — and the busy-key identity used
 * to dedupe concurrent toggles.
 */
import { describe, expect, it, vi } from "vitest";

// runtime-local-skills.ts imports the api module for its discovery query;
// the identity / disabled-matching helpers under test never call it, but the
// import must resolve without dragging react-native in (vitest lane is node
// env — see vitest.config.ts).
vi.mock("@/data/api", () => ({ api: {} }));
import type {
  DisabledRuntimeSkill,
  RuntimeLocalSkillSummary,
} from "@multica/core/types";
import {
  isRuntimeSkillDisabled,
  runtimeSkillIdentity,
} from "./runtime-local-skills";

const skill: RuntimeLocalSkillSummary = {
  key: "pdf-tools",
  name: "PDF tools",
  description: "Read and write PDFs",
  source_path: "/home/u/.claude/skills/pdf-tools",
  provider: "claude",
  root: "provider",
  can_disable: true,
  file_count: 3,
};

const pluginSkill: RuntimeLocalSkillSummary = {
  ...skill,
  key: "web-search",
  name: "Web search",
  root: "plugin",
  plugin: "search-pack",
};

const runtimeId = "rt-1";

describe("isRuntimeSkillDisabled", () => {
  it("enabled when the disabled set is empty or missing", () => {
    expect(isRuntimeSkillDisabled(undefined, runtimeId, skill)).toBe(false);
    expect(isRuntimeSkillDisabled([], runtimeId, skill)).toBe(false);
  });

  it("enabled when no runtime is resolved", () => {
    expect(
      isRuntimeSkillDisabled(
        [{ runtime_id: runtimeId, provider: "claude", root: "provider", key: "pdf-tools" }],
        undefined,
        skill,
      ),
    ).toBe(false);
  });

  it("matches on runtime + provider + root + key", () => {
    const disabled: DisabledRuntimeSkill[] = [
      { runtime_id: runtimeId, provider: "claude", root: "provider", key: "pdf-tools" },
    ];
    expect(isRuntimeSkillDisabled(disabled, runtimeId, skill)).toBe(true);
  });

  it("ignores entries for other runtimes", () => {
    const disabled: DisabledRuntimeSkill[] = [
      { runtime_id: "rt-other", provider: "claude", root: "provider", key: "pdf-tools" },
    ];
    expect(isRuntimeSkillDisabled(disabled, runtimeId, skill)).toBe(false);
  });

  it("ignores entries for other keys", () => {
    const disabled: DisabledRuntimeSkill[] = [
      { runtime_id: runtimeId, provider: "claude", root: "provider", key: "other" },
    ];
    expect(isRuntimeSkillDisabled(disabled, runtimeId, skill)).toBe(false);
  });

  it("plugin mismatch means not disabled (empty string vs set plugin)", () => {
    const disabledNoPlugin: DisabledRuntimeSkill[] = [
      { runtime_id: runtimeId, provider: "claude", root: "plugin", key: "web-search" },
    ];
    expect(isRuntimeSkillDisabled(disabledNoPlugin, runtimeId, pluginSkill)).toBe(false);
    const disabledWithPlugin: DisabledRuntimeSkill[] = [
      {
        runtime_id: runtimeId,
        provider: "claude",
        root: "plugin",
        key: "web-search",
        plugin: "search-pack",
      },
    ];
    expect(isRuntimeSkillDisabled(disabledWithPlugin, runtimeId, pluginSkill)).toBe(true);
  });

  it("a skill without a root is never disabled", () => {
    const rootless = { ...skill, root: undefined } as RuntimeLocalSkillSummary;
    const disabled: DisabledRuntimeSkill[] = [
      { runtime_id: runtimeId, provider: "claude", root: "provider", key: "pdf-tools" },
    ];
    expect(isRuntimeSkillDisabled(disabled, runtimeId, rootless)).toBe(false);
  });
});

describe("runtimeSkillIdentity", () => {
  it("encodes root + key + plugin", () => {
    expect(runtimeSkillIdentity(skill)).toBe("runtime:provider:pdf-tools:");
    expect(runtimeSkillIdentity(pluginSkill)).toBe(
      "runtime:plugin:web-search:search-pack",
    );
  });

  it("missing root falls back to unknown", () => {
    const rootless = { ...skill, root: undefined } as RuntimeLocalSkillSummary;
    expect(runtimeSkillIdentity(rootless)).toBe("runtime:unknown:pdf-tools:");
  });

  it("different plugins yield distinct identities", () => {
    const a = { ...pluginSkill, plugin: "pack-a" };
    const b = { ...pluginSkill, plugin: "pack-b" };
    expect(runtimeSkillIdentity(a)).not.toEqual(runtimeSkillIdentity(b));
  });
});
