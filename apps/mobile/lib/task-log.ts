/**
 * Pure helpers for rendering a task's execution log (`/api/tasks/:id/messages`)
 * in the issue Runs sheet. The message stream is a sequence of step payloads
 * (`thinking` / `tool_use` / `tool_result` / `error`) interleaved with free-text
 * `text` chunks — the run log shows both, while the chat screen's
 * `ChatTimeline` shows only process steps (the chat parent renders the final text).
 */
import type { TaskMessagePayload } from "@multica/core/types";

export interface TaskLogPartition {
  /** Non-text steps in original order — drive the `ChatTimeline` fold. */
  processSteps: TaskMessagePayload[];
  /** Non-empty `text` payload content, in order — agent's prose narration. */
  textFragments: string[];
}

/** Split a task message stream into process steps (for ChatTimeline) and the
 *  agent's own `text` narration. Purely derived — no I/O. */
export function partitionTaskLog(
  messages: TaskMessagePayload[],
): TaskLogPartition {
  const processSteps: TaskMessagePayload[] = [];
  const textFragments: string[] = [];
  for (const m of messages) {
    if (m.type === "text") {
      const c = (m.content ?? "").trim();
      if (c) textFragments.push(c);
    } else {
      processSteps.push(m);
    }
  }
  return { processSteps, textFragments };
}

/**
 * Most informative single-line summary from a `tool_use` payload — mirrors
 * web's `getToolSummary` (packages/views/chat/components/chat-message-list.tsx)
 * and the private copy in components/chat/chat-timeline.tsx. Order matters:
 * `query` / `file_path` / `pattern` are the headline params, `command` /
 * `prompt` get truncated, and a final loop catches any short string a future
 * tool might emit. Extracted here so the run log and chat timeline share one
 * implementation (single source of truth for tool summaries).
 */
export function getToolSummary(item: TaskMessagePayload): string {
  if (!item.input) return "";
  const inp = item.input as Record<string, unknown>;
  const pick = (k: string): string | undefined => {
    const v = inp[k];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const q = pick("query");
  if (q) return q;
  const fp = pick("file_path") ?? pick("path");
  if (fp) return shortenPath(fp);
  const p = pick("pattern");
  if (p) return p;
  const d = pick("description");
  if (d) return d;
  const cmd = pick("command");
  if (cmd) return cmd.length > 100 ? `${cmd.slice(0, 100)}…` : cmd;
  const prompt = pick("prompt");
  if (prompt) return prompt.length > 100 ? `${prompt.slice(0, 100)}…` : prompt;
  const skill = pick("skill");
  if (skill) return skill;
  for (const v of Object.values(inp)) {
    if (typeof v === "string" && v.length > 0 && v.length < 120) return v;
  }
  return "";
}

function shortenPath(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-2).join("/")}`;
}