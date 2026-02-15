/**
 * E2E Integration Test: Phase 3 + Phase 4 — Budget Control + Report Enhancement
 *
 * Tests the full system prompt build flow with budget-controlled sections
 * and enhanced report diagnostics.
 */
import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildSystemPromptWithReport } from "./builder.js";
import { formatPromptReport } from "./report.js";
import {
  DEFAULT_BOOTSTRAP_MAX_CHARS,
  DEFAULT_SKILLS_MAX_CHARS,
  truncateWithBudget,
} from "./sections.js";

describe("Phase 3 E2E: Budget Control in Full Prompt Build", () => {
  it("truncates oversized workspace.md in full prompt", () => {
    const oversizedWorkspace = "HEADER\n" + "X".repeat(30_000) + "\nFOOTER";
    const prompt = buildSystemPrompt({
      mode: "full",
      profile: { workspace: oversizedWorkspace },
    });

    // Prompt should be shorter than raw inclusion
    expect(prompt.length).toBeLessThan(oversizedWorkspace.length + 5000); // allow for other sections
    // Truncation marker should be present
    expect(prompt).toContain("characters omitted");
    // Head content preserved
    expect(prompt).toContain("HEADER");
    // Tail content preserved
    expect(prompt).toContain("FOOTER");
  });

  it("truncates oversized skills prompt in full prompt", () => {
    const oversizedSkills = "## myskill\n" + "Z".repeat(20_000) + "\nSKILL_END";
    const prompt = buildSystemPrompt({
      mode: "full",
      skillsPrompt: oversizedSkills,
    });

    expect(prompt).toContain("## Skills (mandatory)");
    expect(prompt).toContain("characters omitted");
    expect(prompt).toContain("## myskill");
    expect(prompt).toContain("SKILL_END");
  });

  it("truncates both workspace AND skills independently", () => {
    const bigWorkspace = "WS_HEAD\n" + "A".repeat(25_000) + "\nWS_TAIL";
    const bigSkills = "## sk\n" + "B".repeat(15_000) + "\nSK_TAIL";

    const prompt = buildSystemPrompt({
      mode: "full",
      profile: { workspace: bigWorkspace },
      skillsPrompt: bigSkills,
    });

    // Both sections should be truncated
    const markers = (prompt.match(/characters omitted/g) ?? []).length;
    expect(markers).toBe(2);

    // Both heads and tails preserved
    expect(prompt).toContain("WS_HEAD");
    expect(prompt).toContain("WS_TAIL");
    expect(prompt).toContain("## sk");
    expect(prompt).toContain("SK_TAIL");
  });

  it("does NOT truncate small workspace and skills", () => {
    const smallWorkspace = "Small workspace rules.";
    const smallSkills = "## commit\nDo conventional commits.";

    const prompt = buildSystemPrompt({
      mode: "full",
      profile: { workspace: smallWorkspace },
      skillsPrompt: smallSkills,
    });

    expect(prompt).not.toContain("characters omitted");
    expect(prompt).toContain("Small workspace rules.");
    expect(prompt).toContain("Do conventional commits.");
  });

  it("does not affect minimal or none modes", () => {
    const bigWorkspace = "W".repeat(30_000);
    const bigSkills = "## s\n" + "S".repeat(20_000);

    // Minimal mode excludes workspace and skills
    const minimal = buildSystemPrompt({
      mode: "minimal",
      profile: { workspace: bigWorkspace },
      skillsPrompt: bigSkills,
    });
    expect(minimal).not.toContain("characters omitted");

    // None mode excludes workspace and skills
    const none = buildSystemPrompt({
      mode: "none",
      profile: { workspace: bigWorkspace },
      skillsPrompt: bigSkills,
    });
    expect(none).not.toContain("characters omitted");
  });
});

describe("Phase 4 E2E: Report Enhancement", () => {
  it("report includes truncation metadata for oversized workspace", () => {
    const oversized = "X".repeat(25_000);
    const { report } = buildSystemPromptWithReport({
      mode: "full",
      profile: { workspace: oversized },
    });

    const ws = report.sections.find((s) => s.name === "workspace")!;
    expect(ws.included).toBe(true);
    expect(ws.truncated).toBe(true);
    expect(ws.originalChars).toBe(25_000);
    expect(ws.chars).toBeLessThan(25_000);
  });

  it("report includes truncation metadata for oversized skills", () => {
    const oversized = "## sk\n" + "Y".repeat(15_000);
    const { report } = buildSystemPromptWithReport({
      mode: "full",
      skillsPrompt: oversized,
    });

    const sk = report.sections.find((s) => s.name === "skills")!;
    expect(sk.included).toBe(true);
    expect(sk.truncated).toBe(true);
    expect(sk.originalChars).toBe(oversized.trim().length);
  });

  it("report does NOT flag truncation for small content", () => {
    const { report } = buildSystemPromptWithReport({
      mode: "full",
      profile: { workspace: "Small" },
      skillsPrompt: "## commit\nOK",
    });

    const ws = report.sections.find((s) => s.name === "workspace")!;
    expect(ws.truncated).toBeUndefined();
    expect(ws.originalChars).toBeUndefined();

    const sk = report.sections.find((s) => s.name === "skills")!;
    expect(sk.truncated).toBeUndefined();
  });

  it("formatPromptReport includes token estimate", () => {
    const { report } = buildSystemPromptWithReport({
      mode: "full",
      tools: ["read", "write", "exec"],
    });

    const formatted = formatPromptReport(report);
    const expectedTokens = Math.ceil(report.totalChars / 4);
    expect(formatted).toContain(`~${expectedTokens} tokens`);
  });

  it("formatPromptReport shows truncation detail", () => {
    const { report } = buildSystemPromptWithReport({
      mode: "full",
      profile: { workspace: "X".repeat(25_000) },
    });

    const formatted = formatPromptReport(report);
    expect(formatted).toContain("truncated from 25000 chars");
  });

  it("formatPromptReport does NOT show truncation for small sections", () => {
    const { report } = buildSystemPromptWithReport({
      mode: "full",
      profile: { workspace: "Small" },
    });

    const formatted = formatPromptReport(report);
    expect(formatted).not.toContain("truncated from");
  });
});

describe("truncateWithBudget edge cases", () => {
  it("empty string", () => {
    const result = truncateWithBudget("", 100);
    expect(result).toEqual({ text: "", truncated: false });
  });

  it("budget of 0", () => {
    const result = truncateWithBudget("hello", 0);
    expect(result.truncated).toBe(true);
  });

  it("very large content with very small budget", () => {
    const text = "A".repeat(100_000);
    const result = truncateWithBudget(text, 100);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(text.length);
    expect(result.text).toContain("characters omitted");
  });

  it("content at exact budget boundary", () => {
    const text = "A".repeat(DEFAULT_BOOTSTRAP_MAX_CHARS);
    const result = truncateWithBudget(text, DEFAULT_BOOTSTRAP_MAX_CHARS);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(text);
  });

  it("content at budget + 1", () => {
    const text = "A".repeat(DEFAULT_BOOTSTRAP_MAX_CHARS + 1);
    const result = truncateWithBudget(text, DEFAULT_BOOTSTRAP_MAX_CHARS);
    expect(result.truncated).toBe(true);
  });
});
