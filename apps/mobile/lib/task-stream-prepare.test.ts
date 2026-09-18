import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard for the wiring, not the logic.
 *
 * `prepareTaskMessages` is a pure function, so a unit test can only prove that
 * preparing a stream merges flush-split fragments and masks secrets. It cannot
 * prove that the screens actually call it — the same shape of gap that let the
 * `cancelled` column stay dropped while every unit test passed (iter 157).
 * Mobile vitest is Node-only (no RN renderer, see vitest.config.ts), so the
 * wiring is pinned against the component source: each surface that renders a
 * task message stream must route it through the prepare step, and must not
 * hand the raw stream to the renderer.
 *
 * Both directions are asserted. "Calls prepare" alone would pass on a file
 * that prepares one stream and renders another raw; "does not render raw"
 * alone would pass on a file that stopped rendering the stream entirely.
 */
const COMPONENTS_DIR = path.resolve(__dirname, "../components");

function source(relativePath: string): string {
  return readFileSync(path.join(COMPONENTS_DIR, relativePath), "utf8");
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("task message streams are prepared before they render", () => {
  it("prepares the run log and never partitions the raw stream", () => {
    const src = source("issue/run-log.tsx");

    expect(countOf(src, "prepareTaskLog(")).toBe(1);
    expect(src).not.toMatch(/partitionTaskLog\(\s*data\s*\)/);
  });

  it("prepares the transcript dialog's entries and filters those, not the raw rows", () => {
    const src = source("agent/run-transcript-dialog.tsx");

    expect(countOf(src, "prepareTaskMessages(")).toBe(1);
    expect(src).not.toMatch(/deriveTranscriptFilterOptions\(\s*data\s*\)/);
    expect(src).not.toMatch(/filterTranscriptEntries\(\s*data\s*,/);
  });

  it("prepares both chat timelines — the live trace and the persisted one", () => {
    const src = source("chat/chat-message-list.tsx");

    expect(countOf(src, "prepareTaskMessages(")).toBe(2);
    expect(src).not.toMatch(/items=\{liveTaskMessages \?\? \[\]\}/);
    expect(src).not.toMatch(/items=\{timeline\}/);
  });

  it("masks every string the transcript row renders out of a payload", () => {
    const src = source("agent/transcript-entry.tsx");

    // copy body, tool_use JSON, whole-file write, diff lines
    expect(countOf(src, "redactSecrets(")).toBe(4);
    expect(src).not.toMatch(/setStringAsync\(transcriptEntryCopyText\(entry\)\)/);
    expect(src).not.toMatch(/text=\{JSON\.stringify\(entry\.input/);
    expect(src).not.toMatch(/code=\{diffDetail\.text\}/);
  });
});
