/**
 * Tests for tool policy system.
 * Run with: npx tsx src/agent/tools/policy.test.ts
 */

import { filterTools, type ToolsConfig } from "./policy.js";
import { TOOL_GROUPS, TOOL_PROFILES, expandToolGroups } from "./groups.js";

// Simple test helper
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}`);
    console.error(e);
    process.exit(1);
  }
}

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(
      `${msg || "Assertion failed"}\n  Expected: ${expectedStr}\n  Actual: ${actualStr}`,
    );
  }
}

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

console.log("=== Tool Groups Tests ===\n");

test("expandToolGroups: group:fs", () => {
  const expanded = expandToolGroups(["group:fs"]);
  assertEqual(expanded.sort(), ["edit", "glob", "read", "write"]);
});

test("expandToolGroups: group:runtime", () => {
  const expanded = expandToolGroups(["group:runtime"]);
  assertEqual(expanded.sort(), ["exec", "process"]);
});

test("expandToolGroups: group:web", () => {
  const expanded = expandToolGroups(["group:web"]);
  assertEqual(expanded.sort(), ["web_fetch", "web_search"]);
});

test("expandToolGroups: mixed groups and tools", () => {
  const expanded = expandToolGroups(["group:runtime", "web_fetch"]);
  assertEqual(expanded.sort(), ["exec", "process", "web_fetch"]);
});

console.log("\n=== Tool Profiles Tests ===\n");

test("TOOL_PROFILES: minimal has empty allow", () => {
  assertEqual(TOOL_PROFILES.minimal.allow, []);
});

test("TOOL_PROFILES: coding has fs and runtime", () => {
  assertEqual(TOOL_PROFILES.coding.allow, ["group:fs", "group:runtime"]);
});

test("TOOL_PROFILES: full has no restrictions", () => {
  assertEqual(TOOL_PROFILES.full.allow, undefined);
  assertEqual(TOOL_PROFILES.full.deny, undefined);
});

console.log("\n=== Filter Tests ===\n");

test("filterTools: no config returns all tools", () => {
  const filtered = filterTools(mockTools, {});
  assertEqual(filtered.length, mockTools.length);
});

test("filterTools: minimal profile returns no tools", () => {
  const filtered = filterTools(mockTools, { config: { profile: "minimal" } });
  assertEqual(filtered.length, 0);
});

test("filterTools: coding profile returns fs and runtime", () => {
  const filtered = filterTools(mockTools, { config: { profile: "coding" } });
  const names = filtered.map((t) => t.name).sort();
  assertEqual(names, ["edit", "exec", "glob", "process", "read", "write"]);
});

test("filterTools: web profile returns all", () => {
  const filtered = filterTools(mockTools, { config: { profile: "web" } });
  const names = filtered.map((t) => t.name).sort();
  assertEqual(names, [
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

test("filterTools: full profile returns all tools", () => {
  const filtered = filterTools(mockTools, { config: { profile: "full" } });
  assertEqual(filtered.length, mockTools.length);
});

test("filterTools: deny specific tool", () => {
  const filtered = filterTools(mockTools, { config: { deny: ["exec"] } });
  const names = filtered.map((t) => t.name);
  assertEqual(names.includes("exec"), false);
  assertEqual(names.length, mockTools.length - 1);
});

test("filterTools: allow specific tools", () => {
  const filtered = filterTools(mockTools, {
    config: { allow: ["read", "write"] },
  });
  const names = filtered.map((t) => t.name).sort();
  assertEqual(names, ["read", "write"]);
});

test("filterTools: deny takes precedence over allow", () => {
  const filtered = filterTools(mockTools, {
    config: { allow: ["read", "write", "exec"], deny: ["exec"] },
  });
  const names = filtered.map((t) => t.name).sort();
  assertEqual(names, ["read", "write"]);
});

console.log("\n=== Provider-specific Tests ===\n");

test("filterTools: provider-specific deny", () => {
  const filtered = filterTools(mockTools, {
    config: {
      byProvider: {
        google: { deny: ["exec", "process"] },
      },
    },
    provider: "google",
  });
  const names = filtered.map((t) => t.name);
  assertEqual(names.includes("exec"), false);
  assertEqual(names.includes("process"), false);
  assertEqual(names.length, mockTools.length - 2);
});

test("filterTools: provider not matching does not apply", () => {
  const filtered = filterTools(mockTools, {
    config: {
      byProvider: {
        google: { deny: ["exec", "process"] },
      },
    },
    provider: "openai",
  });
  assertEqual(filtered.length, mockTools.length);
});

console.log("\n=== Subagent Tests ===\n");

test("filterTools: subagent restrictions apply", () => {
  // Currently DEFAULT_SUBAGENT_TOOL_DENY is empty, so no tools are denied
  const filtered = filterTools(mockTools, { isSubagent: true });
  // With empty deny list, all tools are allowed
  assertEqual(filtered.length, mockTools.length);
});

console.log("\n=== Combined Tests ===\n");

test("filterTools: profile + deny", () => {
  const filtered = filterTools(mockTools, {
    config: {
      profile: "coding",
      deny: ["exec"],
    },
  });
  const names = filtered.map((t) => t.name).sort();
  // coding = fs + runtime, minus exec
  assertEqual(names, ["edit", "glob", "process", "read", "write"]);
});

test("filterTools: profile + provider deny", () => {
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
  // web profile - exec
  assertEqual(names, [
    "edit",
    "glob",
    "process",
    "read",
    "web_fetch",
    "web_search",
    "write",
  ]);
});

console.log("\n=== All tests passed! ===\n");
