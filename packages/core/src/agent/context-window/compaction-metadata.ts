/**
 * Compaction Metadata — extract file operations & tool failures from compacted messages
 *
 * Appended to summaries so the agent retains awareness of what files were touched
 * and which tool invocations failed, even after the original messages are removed.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";

// ── Types ──────────────────────────────────────────────────────────────────

export type ToolFailure = {
  toolName: string;
  summary: string;
};

export type FileOperations = {
  readFiles: string[];
  modifiedFiles: string[];
};

// ── Tool failure extraction ────────────────────────────────────────────────

const MAX_TOOL_FAILURES = 8;
const ERROR_SUMMARY_MAX_LEN = 240;

/**
 * Collect tool failures (is_error: true tool_result blocks) from messages.
 * Deduplicates by toolCallId and caps at MAX_TOOL_FAILURES.
 */
export function collectToolFailures(messages: AgentMessage[]): ToolFailure[] {
  const seen = new Set<string>();
  const failures: ToolFailure[] = [];

  // First pass: collect tool_use names keyed by id
  const toolNameById = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const content = (msg as any).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === "tool_use" && block.id && block.name) {
        toolNameById.set(block.id, block.name);
      }
    }
  }

  // Second pass: find is_error tool_result blocks
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const content = (msg as any).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      if (!block.is_error) continue;

      const toolCallId: string = block.tool_use_id ?? block.id ?? "";
      if (!toolCallId || seen.has(toolCallId)) continue;
      seen.add(toolCallId);

      const toolName = toolNameById.get(toolCallId) ?? "unknown";
      let errorText = typeof block.content === "string"
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((b: any) => (typeof b === "string" ? b : b.text ?? "")).join(" ")
          : String(block.content ?? "");
      if (errorText.length > ERROR_SUMMARY_MAX_LEN) {
        errorText = errorText.slice(0, ERROR_SUMMARY_MAX_LEN) + "...";
      }

      failures.push({ toolName, summary: errorText });
      if (failures.length >= MAX_TOOL_FAILURES) return failures;
    }
  }

  return failures;
}

// ── File operation extraction ──────────────────────────────────────────────

const READ_TOOL_NAMES = new Set(["Read", "read_file"]);
const WRITE_TOOL_NAMES = new Set(["Write", "Edit", "write_file", "file_edit"]);

/**
 * Collect file read/modify operations from assistant tool_use blocks.
 * readFiles excludes any path that also appears in modifiedFiles.
 */
export function collectFileOperations(messages: AgentMessage[]): FileOperations {
  const readSet = new Set<string>();
  const modifiedSet = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const content = (msg as any).content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type !== "tool_use") continue;
      const name: string = block.name ?? "";
      const input: any = block.input ?? {};

      // Extract file path from common parameter names
      const filePath: string | undefined =
        input.file_path ?? input.path ?? input.filePath ?? input.filename;
      if (!filePath || typeof filePath !== "string") continue;

      if (READ_TOOL_NAMES.has(name)) {
        readSet.add(filePath);
      } else if (WRITE_TOOL_NAMES.has(name)) {
        modifiedSet.add(filePath);
      }
    }
  }

  // Remove modified files from readFiles (to avoid duplication)
  for (const path of modifiedSet) {
    readSet.delete(path);
  }

  return {
    readFiles: [...readSet],
    modifiedFiles: [...modifiedSet],
  };
}

// ── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format tool failures as a markdown section.
 * Returns empty string if no failures.
 */
export function formatToolFailuresSection(failures: ToolFailure[]): string {
  if (failures.length === 0) return "";

  const lines = failures.map(
    (f) => `- **${f.toolName}**: ${f.summary}`,
  );
  return `\n## Tool Failures\n${lines.join("\n")}`;
}

/**
 * Format file operations as XML sections.
 * Returns empty string if no operations.
 */
export function formatFileOperationsSection(ops: FileOperations): string {
  const parts: string[] = [];

  if (ops.readFiles.length > 0) {
    parts.push(`<read-files>\n${ops.readFiles.join("\n")}\n</read-files>`);
  }
  if (ops.modifiedFiles.length > 0) {
    parts.push(`<modified-files>\n${ops.modifiedFiles.join("\n")}\n</modified-files>`);
  }

  return parts.length > 0 ? "\n" + parts.join("\n") : "";
}
