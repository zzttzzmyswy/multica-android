import { describe, it, expect } from "vitest";
import { filterTools } from "./policy.js";
import { TOOL_PROFILES, expandToolGroups } from "./groups.js";

// Mock tools for testing
const mockTools = [
  { name: "read" },
  { name: "write" },
  { name: "edit" },
  { name: "exec" },
  { name: "process" },
  { name: "glob" },
  { name: "web_fetch" },
  { name: "web_search" },
] as any[];

describe("tool groups", () => {
  it("expandToolGroups: group:fs", () => {
    const expanded = expandToolGroups(["group:fs"]);
    expect(expanded.sort()).toEqual(["edit", "glob", "read", "write"]);
  });

  it("expandToolGroups: group:runtime", () => {
    const expanded = expandToolGroups(["group:runtime"]);
    expect(expanded.sort()).toEqual(["exec", "process"]);
  });

  it("expandToolGroups: group:web", () => {
    const expanded = expandToolGroups(["group:web"]);
    expect(expanded.sort()).toEqual(["web_fetch", "web_search"]);
  });

  it("expandToolGroups: mixed groups and tools", () => {
    const expanded = expandToolGroups(["group:runtime", "web_fetch"]);
    expect(expanded.sort()).toEqual(["exec", "process", "web_fetch"]);
  });
});

describe("tool profiles", () => {
  it("minimal has empty allow", () => {
    expect(TOOL_PROFILES.minimal.allow).toEqual([]);
  });

  it("coding has fs and runtime", () => {
    expect(TOOL_PROFILES.coding.allow).toEqual(["group:fs", "group:runtime"]);
  });

  it("full has no restrictions", () => {
    expect(TOOL_PROFILES.full.allow).toBeUndefined();
    expect(TOOL_PROFILES.full.deny).toBeUndefined();
  });
});

describe("filterTools", () => {
  it("no config returns all tools", () => {
    const filtered = filterTools(mockTools, {});
    expect(filtered.length).toBe(mockTools.length);
  });

  it("minimal profile returns no tools", () => {
    const filtered = filterTools(mockTools, { config: { profile: "minimal" } });
    expect(filtered.length).toBe(0);
  });

  it("coding profile returns fs and runtime", () => {
    const filtered = filterTools(mockTools, { config: { profile: "coding" } });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual(["edit", "exec", "glob", "process", "read", "write"]);
  });

  it("web profile returns all", () => {
    const filtered = filterTools(mockTools, { config: { profile: "web" } });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual([
      "edit",
      "exec",
      "glob",
      "process",
      "read",
      "web_fetch",
      "web_search",
      "write",
    ]);
  });

  it("full profile returns all tools", () => {
    const filtered = filterTools(mockTools, { config: { profile: "full" } });
    expect(filtered.length).toBe(mockTools.length);
  });

  it("deny specific tool", () => {
    const filtered = filterTools(mockTools, { config: { deny: ["exec"] } });
    const names = filtered.map((t) => t.name);
    expect(names.includes("exec")).toBe(false);
    expect(names.length).toBe(mockTools.length - 1);
  });

  it("allow specific tools", () => {
    const filtered = filterTools(mockTools, {
      config: { allow: ["read", "write"] },
    });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual(["read", "write"]);
  });

  it("deny takes precedence over allow", () => {
    const filtered = filterTools(mockTools, {
      config: { allow: ["read", "write", "exec"], deny: ["exec"] },
    });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual(["read", "write"]);
  });
});

describe("provider-specific filtering", () => {
  it("provider-specific deny", () => {
    const filtered = filterTools(mockTools, {
      config: {
        byProvider: {
          google: { deny: ["exec", "process"] },
        },
      },
      provider: "google",
    });
    const names = filtered.map((t) => t.name);
    expect(names.includes("exec")).toBe(false);
    expect(names.includes("process")).toBe(false);
    expect(names.length).toBe(mockTools.length - 2);
  });

  it("provider not matching does not apply", () => {
    const filtered = filterTools(mockTools, {
      config: {
        byProvider: {
          google: { deny: ["exec", "process"] },
        },
      },
      provider: "openai",
    });
    expect(filtered.length).toBe(mockTools.length);
  });
});

describe("subagent restrictions", () => {
  it("subagent restrictions apply", () => {
    const filtered = filterTools(mockTools, { isSubagent: true });
    expect(filtered.length).toBe(mockTools.length);
  });
});

describe("combined filtering", () => {
  it("profile + deny", () => {
    const filtered = filterTools(mockTools, {
      config: {
        profile: "coding",
        deny: ["exec"],
      },
    });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual(["edit", "glob", "process", "read", "write"]);
  });

  it("profile + provider deny", () => {
    const filtered = filterTools(mockTools, {
      config: {
        profile: "web",
        byProvider: {
          google: { deny: ["exec"] },
        },
      },
      provider: "google",
    });
    const names = filtered.map((t) => t.name).sort();
    expect(names).toEqual([
      "edit",
      "glob",
      "process",
      "read",
      "web_fetch",
      "web_search",
      "write",
    ]);
  });
});
