import type { TaskMessagePayload } from "../types/events";
import { redactSecrets } from "./redact";

/** A unified timeline entry: tool calls, thinking, text, and errors in chronological order. */
export interface TimelineItem {
  seq: number;
  type: "tool_use" | "tool_result" | "thinking" | "text" | "error";
  tool?: string;
  content?: string;
  input?: Record<string, unknown>;
  output?: string;
  created_at?: string;
}

/** The fields the merge step reads — satisfied by both `TimelineItem` and the
 *  raw `TaskMessagePayload`, so one implementation serves both shapes. */
interface StreamingFragment {
  seq: number;
  type: string;
  content?: string;
  created_at?: string;
}

function canMergeStreamingText(prev: StreamingFragment, next: StreamingFragment): boolean {
  return (prev.type === "thinking" || prev.type === "text") && prev.type === next.type;
}

/** Merge adjacent same-type `text` / `thinking` fragments that were split only
 *  by daemon flush timing, ordered by `seq`. */
function mergeStreamingFragments<T extends StreamingFragment>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.seq - b.seq);
  const out: T[] = [];

  for (const item of sorted) {
    const prev = out[out.length - 1];
    if (prev && canMergeStreamingText(prev, item)) {
      out[out.length - 1] = {
        ...prev,
        content: `${prev.content ?? ""}${item.content ?? ""}`,
        created_at: item.created_at ?? prev.created_at,
      };
      continue;
    }
    out.push(item);
  }

  return out;
}

export function coalesceTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return mergeStreamingFragments(items);
}

export function appendTimelineItem(items: TimelineItem[], item: TimelineItem): TimelineItem[] {
  return coalesceTimelineItems([...items, item]);
}

function redactTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return items.map((item) => ({
    ...item,
    content: item.content ? redactSecrets(item.content) : item.content,
    output: item.output ? redactSecrets(item.output) : item.output,
  }));
}

/** Build a chronologically ordered timeline from raw task messages. */
export function buildTimeline(msgs: TaskMessagePayload[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const msg of msgs) {
    items.push({
      seq: msg.seq,
      type: msg.type,
      tool: msg.tool,
      content: msg.content,
      input: msg.input,
      output: msg.output,
      created_at: msg.created_at,
    });
  }
  return redactTimelineItems(coalesceTimelineItems(items));
}

// ── Raw message streams ─────────────────────────────────────────────────────
//
// `buildTimeline` reshapes payloads into `TimelineItem`. Consumers that render
// the payload shape directly (the mobile chat timeline, run log and transcript
// dialog) still owe the same two steps — merge the daemon's flush-split
// fragments, then mask secrets — or they show more steps and more secrets than
// the web client does. These three keep that preparation in the payload shape.

/** `buildTimeline`'s merge step, in the raw payload shape. */
export function coalesceTaskMessages(msgs: TaskMessagePayload[]): TaskMessagePayload[] {
  return mergeStreamingFragments(msgs);
}

/** `buildTimeline`'s redaction step, in the raw payload shape. */
export function redactTaskMessages(msgs: TaskMessagePayload[]): TaskMessagePayload[] {
  return msgs.map((msg) => ({
    ...msg,
    content: msg.content ? redactSecrets(msg.content) : msg.content,
    output: msg.output ? redactSecrets(msg.output) : msg.output,
  }));
}

/** Merge then redact a raw task message stream. */
export function prepareTaskMessages(msgs: TaskMessagePayload[]): TaskMessagePayload[] {
  return redactTaskMessages(coalesceTaskMessages(msgs));
}
