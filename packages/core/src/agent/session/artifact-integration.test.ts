/**
 * E2E Integration Test: Phase 1 — Artifact Storage + Pre-emptive Truncation
 *
 * Tests the full flow: SessionManager.saveMessage() → truncateOversizedToolResults → artifact-store
 *
 * Test Matrix:
 * ┌─────────────────────────────────────────┬──────────────────────┐
 * │ Use Case                                │ Expected Outcome     │
 * ├─────────────────────────────────────────┼──────────────────────┤
 * │ UC1: Oversized tool result              │ Truncated + artifact │
 * │ UC2: Small tool result                  │ Pass-through, no art │
 * │ UC3: Head/tail preservation             │ Markers preserved    │
 * │ UC4: Multiple results (mixed sizes)     │ Selective truncation │
 * │ UC5: Feature toggle disabled            │ No truncation        │
 * │ UC6: Session reload after truncation    │ Truncated content    │
 * │ UC7: Truncation marker format           │ Correct format       │
 * │ UC8: Artifact readable after reload     │ Full content intact  │
 * └─────────────────────────────────────────┴──────────────────────┘
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "./session-manager.js";
import { readEntries } from "./storage.js";
import { readToolResultArtifact } from "./artifact-store.js";

const makeTestDir = () => {
  const dir = join(tmpdir(), `multica-e2e-p1-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Extract text from a tool_result content field, which can be:
 * - a string (original format)
 * - an array of { type: "text", text: "..." } (after truncation)
 */
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

describe("Phase 1 E2E: Artifact Storage + Pre-emptive Truncation", () => {
  let testDir: string;
  const sessionId = "test-session-e2e";

  beforeEach(() => {
    testDir = makeTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // UC1: Oversized tool result → truncated in session + artifact saved
  it("UC1: oversized tool result is truncated and artifact is saved with full content", async () => {
    const sm = new SessionManager({
      sessionId,
      baseDir: testDir,
      compactionMode: "tokens",
      contextWindowTokens: 100_000,
      enableToolResultTruncation: true,
      enableToolResultPruning: false,
    });

    const bigContent = "X".repeat(200_000);
    sm.saveMessage({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_abc123", content: bigContent }],
      timestamp: Date.now(),
    } as any);
    await sm.flush();

    // Session file: truncated
    const entries = readEntries(sessionId, { baseDir: testDir });
    const msgEntries = entries.filter((e) => e.type === "message");
    expect(msgEntries.length).toBe(1);

    const saved = (msgEntries[0] as any).message;
    const savedText = extractContentText(saved.content[0].content);
    expect(savedText.length).toBeLessThan(bigContent.length);
    expect(savedText).toContain("Tool result truncated");
    expect(savedText).toContain("artifacts/");

    // Artifact: full content preserved
    const artifactContent = readToolResultArtifact(sessionId, "call_abc123", { baseDir: testDir });
    expect(artifactContent).toBe(bigContent);
    expect(artifactContent!.length).toBe(200_000);
  });

  // UC2: Small tool result → pass-through, no artifact
  it("UC2: small tool result passes through without truncation or artifact", async () => {
    const sm = new SessionManager({
      sessionId,
      baseDir: testDir,
      compactionMode: "tokens",
      contextWindowTokens: 200_000,
      enableToolResultTruncation: true,
      enableToolResultPruning: false,
    });

    const smallContent = "Small result data";
    sm.saveMessage({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_small", content: smallContent }],
      timestamp: Date.now(),
    } as any);
    await sm.flush();

    // Session file: unchanged content
    const entries = readEntries(sessionId, { baseDir: testDir });
    const saved = (entries.find((e) => e.type === "message") as any).message;
    const savedText = extractContentText(saved.content[0].content);
    expect(savedText).toBe(smallContent);

    // No artifacts directory
    const artifactsDir = join(testDir, sessionId, "artifacts");
    expect(existsSync(artifactsDir)).toBe(false);
  });

  // UC3: Head/tail preservation
  it("UC3: truncated content preserves identifiable head and tail markers", async () => {
    const sm = new SessionManager({
      sessionId,
      baseDir: testDir,
      compactionMode: "tokens",
      contextWindowTokens: 50_000,
      enableToolResultTruncation: true,
      enableToolResultPruning: false,
    });

    const head = "HEAD_MARKER_START" + "A".repeat(10_000);
    const middle = "B".repeat(100_000);
    const tail = "C".repeat(10_000) + "TAIL_MARKER_END";
    const bigContent = head + middle + tail;

    sm.saveMessage({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_ht", content: bigContent }],
      timestamp: Date.now(),
    } as any);
    await sm.flush();

    const entries = readEntries(sessionId, { baseDir: testDir });
    const saved = (entries.find((e) => e.type === "message") as any).message;
    const savedText = extractContentText(saved.content[0].content);

    expect(savedText).toContain("HEAD_MARKER_START");
    expect(savedText).toContain("TAIL_MARKER_END");
    expect(savedText.length).toBeLessThan(bigContent.length);
    // Must also have the truncation marker
    expect(savedText).toContain("Tool result truncated");
  });

  // UC4: Multiple tool results — selective truncation
  it("UC4: message with mixed-size tool results truncates only oversized ones", async () => {
    const sm = new SessionManager({
      sessionId,
      baseDir: testDir,
      compactionMode: "tokens",
      contextWindowTokens: 50_000,
      enableToolResultTruncation: true,
      enableToolResultPruning: false,
    });

    const big1 = "BIG1_" + "X".repeat(200_000);
    const small = "SMALL_RESULT_INTACT";
    const big2 = "BIG2_" + "Y".repeat(200_000);

    sm.saveMessage({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_big1", content: big1 },
        { type: "tool_result", tool_use_id: "call_sm", content: small },
        { type: "tool_result", tool_use_id: "call_big2", content: big2 },
      ],
      timestamp: Date.now(),
    } as any);
    await sm.flush();

    const entries = readEntries(sessionId, { baseDir: testDir });
    const saved = (entries.find((e) => e.type === "message") as any).message;

    // Big results: truncated
    const t0 = extractContentText(saved.content[0].content);
    const t2 = extractContentText(saved.content[2].content);
    expect(t0).toContain("Tool result truncated");
    expect(t2).toContain("Tool result truncated");
    expect(t0.length).toBeLessThan(big1.length);
    expect(t2.length).toBeLessThan(big2.length);

    // Small result: intact
    const t1 = extractContentText(saved.content[1].content);
    expect(t1).toBe(small);

    // Both artifacts saved with full content
    const art1 = readToolResultArtifact(sessionId, "call_big1", { baseDir: testDir });
    expect(art1).toBe(big1);
    const art2 = readToolResultArtifact(sessionId, "call_big2", { baseDir: testDir });
    expect(art2).toBe(big2);
  });

  // UC5: Feature disabled → no truncation
  it("UC5: enableToolResultTruncation=false skips all truncation", async () => {
    const sm = new SessionManager({
      sessionId,
      baseDir: testDir,
      compactionMode: "tokens",
      contextWindowTokens: 50_000,
      enableToolResultTruncation: false,
      enableToolResultPruning: false,
    });

    const bigContent = "Z".repeat(200_000);
    sm.saveMessage({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_noop", content: bigContent }],
      timestamp: Date.now(),
    } as any);
    await sm.flush();

    const entries = readEntries(sessionId, { baseDir: testDir });
    const saved = (entries.find((e) => e.type === "message") as any).message;
    const savedText = extractContentText(saved.content[0].content);
    expect(savedText).toBe(bigContent);
    expect(savedText).not.toContain("Tool result truncated");
  });

  // UC6: Session reload after truncation
  it("UC6: loadMessages() returns truncated content after save+reload", async () => {
    const sm = new SessionManager({
      sessionId,
      baseDir: testDir,
      compactionMode: "tokens",
      contextWindowTokens: 100_000,
      enableToolResultTruncation: true,
      enableToolResultPruning: false,
    });

    const bigContent = "RELOAD_TEST_" + "R".repeat(200_000);
    sm.saveMessage({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_reload", content: bigContent }],
      timestamp: Date.now(),
    } as any);
    await sm.flush();

    // Create a fresh SessionManager to reload
    const sm2 = new SessionManager({
      sessionId,
      baseDir: testDir,
      compactionMode: "tokens",
      contextWindowTokens: 100_000,
    });
    const messages = sm2.loadMessages();
    expect(messages.length).toBe(1);

    const loaded = messages[0] as any;
    const loadedText = extractContentText(loaded.content[0].content);
    // Loaded messages should show truncated content (not full)
    expect(loadedText).toContain("Tool result truncated");
    expect(loadedText).toContain("artifacts/");
    expect(loadedText.length).toBeLessThan(bigContent.length);
  });

  // UC7: Truncation marker format
  it("UC7: truncation marker contains original size and artifact path", async () => {
    const sm = new SessionManager({
      sessionId,
      baseDir: testDir,
      compactionMode: "tokens",
      contextWindowTokens: 100_000,
      enableToolResultTruncation: true,
      enableToolResultPruning: false,
    });

    const bigContent = "M".repeat(200_000);
    sm.saveMessage({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_fmt", content: bigContent }],
      timestamp: Date.now(),
    } as any);
    await sm.flush();

    const entries = readEntries(sessionId, { baseDir: testDir });
    const saved = (entries.find((e) => e.type === "message") as any).message;
    const savedText = extractContentText(saved.content[0].content);

    // Marker should include: original size, artifact path, and "read tool" hint
    expect(savedText).toMatch(/original 200000 chars/);
    expect(savedText).toMatch(/Full result saved to artifacts\/call_fmt\.txt/);
    expect(savedText).toContain("read tool");
  });

  // UC8: Artifact readable via readToolResultArtifact after session operations
  it("UC8: artifact is readable by toolCallId and contains exact original content", async () => {
    const sm = new SessionManager({
      sessionId,
      baseDir: testDir,
      compactionMode: "tokens",
      contextWindowTokens: 100_000,
      enableToolResultTruncation: true,
      enableToolResultPruning: false,
    });

    // Use content with specific patterns to verify exact preservation
    const specialContent = "START|" + "αβγδ".repeat(50_000) + "|END";
    sm.saveMessage({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_exact", content: specialContent }],
      timestamp: Date.now(),
    } as any);
    await sm.flush();

    const artifact = readToolResultArtifact(sessionId, "call_exact", { baseDir: testDir });
    expect(artifact).toBe(specialContent);

    // Also verify the artifacts directory exists
    const artifactsDir = join(testDir, sessionId, "artifacts");
    expect(existsSync(artifactsDir)).toBe(true);
  });
});
