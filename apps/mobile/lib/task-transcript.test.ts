import { describe, expect, it } from "vitest";
import type { TaskMessagePayload } from "@multica/core/types";
import {
  collapseTranscriptDiffContext,
  deriveTranscriptFilterOptions,
  diffTranscriptLines,
  filterTranscriptEntries,
  isTranscriptViewable,
  languageForPath,
  parseUnifiedTranscriptDiff,
  resolveActiveFilterKeys,
  sortTranscriptEntries,
  transcriptDiffDetail,
  transcriptEntryCopyText,
  transcriptEntryLabel,
  transcriptFilterKey,
  unwrapToolOutput,
} from "./task-transcript";

/** Minimal entry fixture — only the fields the pure helpers read. */
function entry(overrides: Partial<TaskMessagePayload> & Pick<TaskMessagePayload, "type">): TaskMessagePayload {
  return {
    task_id: "task-1",
    issue_id: "issue-1",
    seq: overrides.seq ?? 1,
    ...overrides,
  };
}

const textEntry = entry({ type: "text", seq: 1, content: "Working on it." });
const thinkingEntry = entry({ type: "thinking", seq: 2, content: "Let me check the file." });
const bashUse = entry({
  type: "tool_use",
  seq: 3,
  tool: "Bash",
  input: { command: "ls -la" },
});
const bashResult = entry({
  type: "tool_result",
  seq: 4,
  tool: "Bash",
  output: '"total 0\\ndrwxr-xr-x 1"\n',
});
const readUse = entry({
  type: "tool_use",
  seq: 5,
  tool: "Read",
  input: { file_path: "/repo/src/index.ts" },
});
const errorEntry = entry({ type: "error", seq: 6, content: "boom" });

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

describe("transcriptEntryLabel", () => {
  it("names prose kinds the way web's traceEventLabel does", () => {
    expect(transcriptEntryLabel(textEntry)).toBe("Agent");
    expect(transcriptEntryLabel(thinkingEntry)).toBe("Thinking");
    expect(transcriptEntryLabel(errorEntry)).toBe("Error");
  });

  it("shows the provider-native tool name verbatim", () => {
    expect(transcriptEntryLabel(bashUse)).toBe("Bash");
    expect(transcriptEntryLabel(bashResult)).toBe("Bash");
  });

  it("falls back to Tool/Result when a tool event carries no name", () => {
    expect(transcriptEntryLabel(entry({ type: "tool_use" }))).toBe("Tool");
    expect(transcriptEntryLabel(entry({ type: "tool_result" }))).toBe("Result");
  });
});

describe("transcriptFilterKey", () => {
  it("collapses tool_use AND tool_result into one `tool:<Name>` facet (web getItemFilterKey)", () => {
    expect(transcriptFilterKey(bashUse)).toBe("tool:Bash");
    expect(transcriptFilterKey(bashResult)).toBe("tool:Bash");
    expect(transcriptFilterKey(readUse)).toBe("tool:Read");
  });

  it("keys non-tool events by their raw type", () => {
    expect(transcriptFilterKey(textEntry)).toBe("text");
    expect(transcriptFilterKey(thinkingEntry)).toBe("thinking");
    expect(transcriptFilterKey(errorEntry)).toBe("error");
  });

  it("does not collapse a toolless tool event", () => {
    expect(transcriptFilterKey(entry({ type: "tool_use" }))).toBe("tool_use");
  });
});

describe("deriveTranscriptFilterOptions", () => {
  it("returns [] for an empty transcript", () => {
    expect(deriveTranscriptFilterOptions([])).toEqual([]);
  });

  it("derives one option per distinct tool, labelled `tool:<Name>`", () => {
    const options = deriveTranscriptFilterOptions([bashUse, bashResult, readUse]);
    const toolOptions = options.filter((o) => o.key.startsWith("tool:"));
    expect(toolOptions).toEqual([
      { key: "tool:Bash", label: "tool:Bash" },
      { key: "tool:Read", label: "tool:Read" },
    ]);
  });

  it("derives a labelled option per non-tool type", () => {
    const options = deriveTranscriptFilterOptions([textEntry, thinkingEntry, errorEntry]);
    expect(options).toEqual([
      { key: "text", label: "Agent" },
      { key: "error", label: "Error" },
      { key: "thinking", label: "Thinking" },
    ]);
  });

  it("dedupes repeated types and sorts options by label (web sort parity)", () => {
    const options = deriveTranscriptFilterOptions([
      bashUse,
      bashResult,
      thinkingEntry,
      thinkingEntry,
      textEntry,
    ]);
    expect(options.map((o) => o.key)).toEqual([
      "text", // "Agent" sorts first
      "thinking", // "Thinking"
      "tool:Bash", // lowercase "tool:" sorts last
    ]);
  });
});

describe("resolveActiveFilterKeys", () => {
  const options = deriveTranscriptFilterOptions([textEntry, bashUse, bashResult]);

  it("keeps selected keys the transcript actually has", () => {
    expect(resolveActiveFilterKeys(["tool:Bash"], options)).toEqual(["tool:Bash"]);
  });

  it("drops a stale key so it no-ops instead of blanking the list (web parity)", () => {
    expect(resolveActiveFilterKeys(["tool:Gone", "text"], options)).toEqual(["text"]);
  });
});

describe("filterTranscriptEntries", () => {
  const transcript = [textEntry, bashUse, bashResult, readUse, thinkingEntry];

  it("returns every entry when nothing is selected (no filtering)", () => {
    expect(filterTranscriptEntries(transcript, [])).toEqual(transcript);
  });

  it("keeps BOTH the tool_use and tool_result for a selected tool facet (strict, web parity)", () => {
    expect(filterTranscriptEntries(transcript, ["tool:Bash"])).toEqual([bashUse, bashResult]);
  });

  it("is strict — an unknown key matches nothing", () => {
    expect(filterTranscriptEntries(transcript, ["tool:Missing"])).toEqual([]);
  });

  it("unions multiple selected keys", () => {
    expect(filterTranscriptEntries(transcript, ["text", "tool:Read"])).toEqual([textEntry, readUse]);
  });
});

describe("sortTranscriptEntries", () => {
  const transcript = [textEntry, bashUse, bashResult];

  it("keeps the original order for oldest_first", () => {
    expect(sortTranscriptEntries(transcript, "oldest_first")).toEqual(transcript);
  });

  it("reverses for newest_first", () => {
    expect(sortTranscriptEntries(transcript, "newest_first")).toEqual([
      bashResult,
      bashUse,
      textEntry,
    ]);
  });

  it("never mutates the input array", () => {
    const input = [...transcript];
    sortTranscriptEntries(input, "newest_first");
    expect(input).toEqual(transcript);
  });
});

describe("unwrapToolOutput", () => {
  it("decodes one JSON string layer so escaped newlines read as terminal output", () => {
    expect(unwrapToolOutput('"line 1\\nline 2"')).toBe("line 1\nline 2");
  });

  it("leaves plain prose untouched", () => {
    expect(unwrapToolOutput("line 1\nline 2")).toBe("line 1\nline 2");
  });

  it("leaves a bare JSON document untouched (only one layer is decoded)", () => {
    expect(unwrapToolOutput('{"a":1}')).toBe('{"a":1}');
  });
});

describe("transcriptEntryCopyText", () => {
  it("copies the full input JSON of a tool call, labelled", () => {
    expect(transcriptEntryCopyText(bashUse)).toBe('[Bash] {\n  "command": "ls -la"\n}');
  });

  it("copies a tool result unwrapped, matching what the row shows", () => {
    expect(transcriptEntryCopyText(bashResult)).toBe("[Bash] total 0\ndrwxr-xr-x 1");
  });

  it("copies prose content", () => {
    expect(transcriptEntryCopyText(textEntry)).toBe("[Agent] Working on it.");
  });

  it("prefixes an RFC 3339 timestamp when the entry has one", () => {
    expect(
      transcriptEntryCopyText(entry({ type: "error", content: "boom", created_at: "2026-09-13T12:00:00.000Z" })),
    ).toBe("[2026-09-13T12:00:00.000Z] [Error] boom");
  });
});

describe("diffTranscriptLines", () => {
  it("keeps equal lines as context and marks changes", () => {
    const lines = diffTranscriptLines(["a", "b", "c"], ["a", "B", "c"]);
    expect(lines).toEqual([
      { kind: "context", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "B" },
      { kind: "context", text: "c" },
    ]);
  });

  it("treats a pure insertion as one add block", () => {
    expect(diffTranscriptLines(["a"], ["a", "b"])).toEqual([
      { kind: "context", text: "a" },
      { kind: "add", text: "b" },
    ]);
  });
});

describe("collapseTranscriptDiffContext", () => {
  it("collapses a long unchanged run into a single gap with its hidden count", () => {
    const context = Array.from({ length: 10 }, (_, i) => ({ kind: "context" as const, text: `c${i}` }));
    const lines = [...context, { kind: "add" as const, text: "new" }, ...context];
    const collapsed = collapseTranscriptDiffContext(lines, 3);
    const gap = collapsed.find((l) => l.kind === "gap");
    expect(gap).toBeDefined();
    // Leading run keeps 0 lines on the outer edge + 3 facing the change.
    expect(gap?.hidden).toBe(7);
    expect(collapsed.filter((l) => l.kind === "add")).toHaveLength(1);
  });

  it("leaves a run short enough that collapsing saves nothing alone", () => {
    const lines = [
      { kind: "context" as const, text: "a" },
      { kind: "add" as const, text: "b" },
    ];
    expect(collapseTranscriptDiffContext(lines, 3)).toEqual(lines);
  });
});

describe("parseUnifiedTranscriptDiff", () => {
  it("skips file headers and maps +/-/context lines", () => {
    const diff = [
      "diff --git a/x.ts b/x.ts",
      "index 111..222 100644",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@",
      " keep",
      "-old",
      "+new",
    ].join("\n");
    expect(parseUnifiedTranscriptDiff(diff)).toEqual([
      { kind: "gap", text: "@@ -1,2 +1,2 @@" },
      { kind: "context", text: "keep" },
      { kind: "remove", text: "old" },
      { kind: "add", text: "new" },
    ]);
  });

  it("treats +++/--- past the first hunk as file content, not headers", () => {
    const diff = ["@@ -1 +1 @@", "--- not a header", "+++ still content"].join("\n");
    expect(parseUnifiedTranscriptDiff(diff)).toEqual([
      { kind: "gap", text: "@@ -1 +1 @@" },
      { kind: "remove", text: "-- not a header" },
      { kind: "add", text: "++ still content" },
    ]);
  });
});

describe("languageForPath", () => {
  it("resolves common extensions to Shiki language ids", () => {
    expect(languageForPath("apps/mobile/lib/a.ts")).toBe("typescript");
    expect(languageForPath("main.py")).toBe("python");
    expect(languageForPath("src/lib.rs")).toBe("rust");
    expect(languageForPath("server.go")).toBe("go");
    expect(languageForPath("deploy.sh")).toBe("bash");
    expect(languageForPath("config.yaml")).toBe("yaml");
  });

  it("returns undefined for unknown or absent extensions (degrades to plaintext)", () => {
    expect(languageForPath("NOTES.unknownext")).toBeUndefined();
    expect(languageForPath("Makefile")).toBeUndefined();
  });
});

describe("transcriptDiffDetail", () => {
  it("reads an Edit-style before/after pair as a collapsed diff", () => {
    const detail = transcriptDiffDetail(
      entry({
        type: "tool_use",
        tool: "Edit",
        input: { file_path: "src/a.ts", old_string: "const x = 1;", new_string: "const x = 2;" },
      }),
    );
    expect(detail?.kind).toBe("diff");
    if (detail?.kind !== "diff") throw new Error("expected diff");
    expect(detail.path).toBe("src/a.ts");
    expect(detail.lines).toEqual([
      { kind: "remove", text: "const x = 1;" },
      { kind: "add", text: "const x = 2;" },
    ]);
  });

  it("reads a whole-file Write as file content, not an all-additions diff", () => {
    const detail = transcriptDiffDetail(
      entry({ type: "tool_use", tool: "Write", input: { file_path: "src/new.ts", content: "a\nb" } }),
    );
    expect(detail).toEqual({ kind: "file", path: "src/new.ts", text: "a\nb", lineCount: 2 });
  });

  it("returns null for a tool call that is not a file mutation", () => {
    expect(transcriptDiffDetail(bashUse)).toBeNull();
    expect(transcriptDiffDetail(bashResult)).toBeNull();
  });
});
