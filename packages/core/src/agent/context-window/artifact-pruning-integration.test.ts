/**
 * E2E Integration Test: Phase 2 — Artifact-Aware Pruning + Summary Fallback
 *
 * Test Matrix:
 * ┌──────────────────────────────────────────────┬──────────────────────────────┐
 * │ Use Case                                     │ Expected Outcome             │
 * ├──────────────────────────────────────────────┼──────────────────────────────┤
 * │ UC1: Soft trim with artifact ref             │ Artifact ref in trim note    │
 * │ UC2: Hard clear with artifact ref            │ Artifact ref in placeholder  │
 * │ UC3: Soft trim without artifact ref          │ Normal trim (no artifact)    │
 * │ UC4: Summary fallback extracts artifact refs │ "Saved Artifacts" section    │
 * │ UC5: Cross-phase: Phase1 output → Phase2     │ Ref survives full pipeline   │
 * └──────────────────────────────────────────────┴──────────────────────────────┘
 */
import { describe, it, expect } from "vitest";
import { pruneToolResults } from "./tool-result-pruning.js";
import { truncateOversizedToolResults } from "./tool-result-truncation.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

function makeToolResultMessage(text: string, toolUseId = "call_1"): AgentMessage {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUseId, content: text }],
    timestamp: Date.now(),
  } as any;
}

function makeAssistantMessage(text = "OK"): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as any;
}

/** A real user message (not tool_result) — needed for bootstrap protection in pruneToolResults */
function makeUserMessage(text = "Hello"): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
  } as any;
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("");
  }
  return "";
}

describe("Phase 2 E2E: Artifact-Aware Pruning", () => {
  // UC1: Soft trim preserves artifact reference
  it("UC1: soft trim preserves artifact reference in trimmed note", () => {
    // Tool result with an artifact reference from Phase 1 truncation
    const truncatedContent =
      "A".repeat(3000) +
      "\n\n[Tool result truncated: original 200000 chars. Full result saved to artifacts/call_abc123.txt. Use the read tool to access the complete data if needed.]\n\n" +
      "B".repeat(3000);

    const messages: AgentMessage[] = [
      makeUserMessage("start"),
      makeAssistantMessage("Calling tool..."),
      makeToolResultMessage(truncatedContent),
      makeAssistantMessage("Processing..."),
      makeToolResultMessage("small result"),
      makeAssistantMessage("recent1"),
      makeToolResultMessage("recent result"),
      makeAssistantMessage("recent2"),
      makeToolResultMessage("recent result 2"),
      makeAssistantMessage("recent3"),
      makeToolResultMessage("latest"),
    ];

    const result = pruneToolResults({
      messages,
      contextWindowTokens: 5_000,
      settings: {
        softTrimRatio: 0.0, // Always trigger
        hardClearRatio: 1.0, // Never hard clear
        minPrunableToolChars: 100,
        keepLastAssistants: 3,
        softTrim: { maxChars: 2_000, headChars: 500, tailChars: 500 },
        hardClear: { enabled: false, placeholder: "[Content removed]" },
      },
    });

    // Must actually trigger soft trimming
    expect(result.changed).toBe(true);
    expect(result.softTrimmed).toBeGreaterThan(0);

    // The trimmed message should preserve the artifact reference (index 2 due to prepended user msg)
    const trimmedMsg = result.messages[2] as any;
    const text = extractContentText(trimmedMsg.content[0]?.content ?? trimmedMsg.content[0]);
    expect(text).toContain("artifacts/call_abc123.txt");
  });

  // UC2: Hard clear preserves artifact reference
  it("UC2: hard clear preserves artifact reference in placeholder", () => {
    const truncatedContent =
      "X".repeat(80_000) +
      "\n\n[Tool result truncated: Full result saved to artifacts/call_xyz.txt.]\n\n" +
      "Y".repeat(20_000);

    const messages: AgentMessage[] = [
      makeUserMessage("start"),
      makeAssistantMessage("old"),
      makeToolResultMessage(truncatedContent),
      makeAssistantMessage("a1"),
      makeToolResultMessage("r1"),
      makeAssistantMessage("a2"),
      makeToolResultMessage("r2"),
      makeAssistantMessage("a3"),
      makeToolResultMessage("r3"),
      makeAssistantMessage("a4"),
      makeToolResultMessage("r4"),
    ];

    const result = pruneToolResults({
      messages,
      contextWindowTokens: 2_000,
      settings: {
        softTrimRatio: 0.0,
        hardClearRatio: 0.0, // Always trigger
        minPrunableToolChars: 100,
        keepLastAssistants: 3,
        softTrim: { maxChars: 50, headChars: 20, tailChars: 20 },
        hardClear: { enabled: true, placeholder: "[Content removed]" },
      },
    });

    expect(result.changed).toBe(true);
    expect(result.hardCleared).toBeGreaterThan(0);

    // The hard-cleared message should contain both the placeholder AND the artifact ref
    const clearedMsg = result.messages[2] as any;
    const text = extractContentText(clearedMsg.content[0]?.content ?? clearedMsg.content[0]);
    expect(text).toContain("[Content removed]");
    expect(text).toContain("artifacts/call_xyz.txt");
  });

  // UC3: Soft trim without artifact ref (baseline behavior unchanged)
  it("UC3: soft trim without artifact reference works normally", () => {
    const plainContent = "D".repeat(6_000); // No artifact reference

    const messages: AgentMessage[] = [
      makeUserMessage("start"),
      makeAssistantMessage("call"),
      makeToolResultMessage(plainContent),
      makeAssistantMessage("r1"),
      makeToolResultMessage("s"),
      makeAssistantMessage("r2"),
      makeToolResultMessage("s"),
      makeAssistantMessage("r3"),
      makeToolResultMessage("s"),
    ];

    const result = pruneToolResults({
      messages,
      contextWindowTokens: 5_000,
      settings: {
        softTrimRatio: 0.0,
        hardClearRatio: 1.0,
        minPrunableToolChars: 100,
        keepLastAssistants: 3,
        softTrim: { maxChars: 2_000, headChars: 500, tailChars: 500 },
        hardClear: { enabled: false, placeholder: "" },
      },
    });

    expect(result.changed).toBe(true);
    expect(result.softTrimmed).toBeGreaterThan(0);

    const trimmedMsg = result.messages[2] as any;
    const text = extractContentText(trimmedMsg.content[0]?.content ?? trimmedMsg.content[0]);
    // Should have trim note but no artifact reference
    expect(text).toContain("Tool result trimmed");
    expect(text).not.toContain("artifacts/");
  });
});

describe("Phase 2 E2E: Summary Fallback Artifact Extraction", () => {
  // UC4: summary fallback extracts artifact references
  it("UC4: summary fallback includes 'Saved Artifacts' section with all artifact refs", async () => {
    const mod = await import("./summary-fallback.js");

    const messages: AgentMessage[] = [
      makeAssistantMessage("Let me read the file"),
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_1",
            content: [
              {
                type: "text",
                text: "DATA_HEAD...\n\n[Tool result truncated: original 500000 chars. Full result saved to artifacts/call_1.txt. Use the read tool.]\n\n...DATA_TAIL",
              },
            ],
          },
        ],
        timestamp: Date.now(),
      } as any,
      makeAssistantMessage("Let me check another"),
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "call_2",
            content: "Result trimmed. Full result available at artifacts/call_2.txt.",
          },
        ],
        timestamp: Date.now(),
      } as any,
    ];

    // Force Level 3 fallback (plain text) by using a model that always throws
    const failingModel = {
      complete: () => { throw new Error("Test: no LLM"); },
    };

    const result = await mod.summarizeWithFallback({
      messages,
      model: failingModel as any,
      reserveTokens: 1024,
      apiKey: "test-key",
      instructions: "summarize",
      availableTokens: 100_000,
    });

    // Must fall through to Level 3
    expect(result.level).toBe(3);
    // Summary must contain artifact references
    expect(result.summary).toContain("## Saved Artifacts");
    expect(result.summary).toContain("artifacts/call_1.txt");
    expect(result.summary).toContain("artifacts/call_2.txt");
  });
});

describe("Cross-Phase E2E: Phase 1 → Phase 2 Pipeline", () => {
  // UC5: Phase 1 truncation output → Phase 2 pruning — artifact ref survives
  it("UC5: artifact ref from Phase 1 truncation survives Phase 2 soft trim", () => {
    // Phase 1: truncate an oversized tool result
    const bigContent = "ORIGINAL_DATA_" + "Q".repeat(200_000);
    let artifactPath = "";

    const phase1Result = truncateOversizedToolResults({
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_cross", content: bigContent }],
        timestamp: Date.now(),
      } as any,
      contextWindowTokens: 50_000,
      saveArtifact: (_id, _content) => {
        artifactPath = `artifacts/call_cross.txt`;
        return artifactPath;
      },
    });

    // Phase 1 must have truncated
    expect(phase1Result.truncated).toBe(true);
    expect(phase1Result.artifacts.length).toBe(1);
    expect(phase1Result.artifacts[0]!.toolCallId).toBe("call_cross");

    // Extract the truncated text from Phase 1 output
    const phase1Msg = phase1Result.message as any;
    const phase1Text = extractContentText(phase1Msg.content[0].content);
    expect(phase1Text).toContain("artifacts/call_cross.txt");

    // Phase 2: feed Phase 1 output into pruneToolResults
    const messages: AgentMessage[] = [
      makeUserMessage("start"),
      makeAssistantMessage("calling"),
      phase1Result.message, // This is the Phase 1 truncated message
      makeAssistantMessage("a1"),
      makeToolResultMessage("s1"),
      makeAssistantMessage("a2"),
      makeToolResultMessage("s2"),
      makeAssistantMessage("a3"),
      makeToolResultMessage("s3"),
    ];

    const phase2Result = pruneToolResults({
      messages,
      contextWindowTokens: 3_000,
      settings: {
        softTrimRatio: 0.0, // Always trigger
        hardClearRatio: 1.0, // No hard clear
        minPrunableToolChars: 100,
        keepLastAssistants: 3,
        softTrim: { maxChars: 2_000, headChars: 500, tailChars: 500 },
        hardClear: { enabled: false, placeholder: "" },
      },
    });

    expect(phase2Result.changed).toBe(true);

    // The artifact reference must survive the Phase 2 soft trim (index 2 due to prepended user msg)
    const finalMsg = phase2Result.messages[2] as any;
    const finalText = extractContentText(finalMsg.content[0]?.content ?? finalMsg.content[0]);
    expect(finalText).toContain("artifacts/call_cross.txt");
  });

  // UC5b: Phase 1 → Phase 2 hard clear also preserves
  it("UC5b: artifact ref from Phase 1 truncation survives Phase 2 hard clear", () => {
    const bigContent = "HC_DATA_" + "W".repeat(200_000);

    const phase1Result = truncateOversizedToolResults({
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_hc", content: bigContent }],
        timestamp: Date.now(),
      } as any,
      contextWindowTokens: 50_000,
      saveArtifact: () => "artifacts/call_hc.txt",
    });

    expect(phase1Result.truncated).toBe(true);

    const messages: AgentMessage[] = [
      makeUserMessage("start"),
      makeAssistantMessage("calling"),
      phase1Result.message,
      makeAssistantMessage("a1"),
      makeToolResultMessage("s1"),
      makeAssistantMessage("a2"),
      makeToolResultMessage("s2"),
      makeAssistantMessage("a3"),
      makeToolResultMessage("s3"),
    ];

    const phase2Result = pruneToolResults({
      messages,
      contextWindowTokens: 1_000,
      settings: {
        softTrimRatio: 0.0,
        hardClearRatio: 0.0, // Always hard clear
        minPrunableToolChars: 100,
        keepLastAssistants: 3,
        softTrim: { maxChars: 50, headChars: 20, tailChars: 20 },
        hardClear: { enabled: true, placeholder: "[Cleared]" },
      },
    });

    expect(phase2Result.changed).toBe(true);
    expect(phase2Result.hardCleared).toBeGreaterThan(0);

    const finalMsg = phase2Result.messages[2] as any;
    const finalText = extractContentText(finalMsg.content[0]?.content ?? finalMsg.content[0]);
    expect(finalText).toContain("[Cleared]");
    expect(finalText).toContain("artifacts/call_hc.txt");
  });
});
