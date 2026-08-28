import { describe, expect, it } from "vitest";
import { isTranscriptViewable } from "./task-transcript";

describe("isTranscriptViewable", () => {
  it("hides the entry for queued tasks — no messages exist yet (web `showTranscript` parity)", () => {
    expect(isTranscriptViewable("queued")).toBe(false);
  });

  it("shows the entry for active non-queued statuses", () => {
    expect(isTranscriptViewable("dispatched")).toBe(true);
    expect(isTranscriptViewable("waiting_local_directory")).toBe(true);
    expect(isTranscriptViewable("running")).toBe(true);
  });

  it("shows the entry for terminal statuses", () => {
    expect(isTranscriptViewable("completed")).toBe(true);
    expect(isTranscriptViewable("failed")).toBe(true);
    expect(isTranscriptViewable("cancelled")).toBe(true);
  });
});