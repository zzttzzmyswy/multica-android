import type { AgentTask, TaskMessagePayload } from "@multica/core/types";

/**
 * Whether a task row may open the execution-transcript view. Mirrors web
 * `activity-tab.tsx`'s `showTranscript = task.status !== "queued"` — queued
 * tasks carry no messages yet, so the entry is hidden rather than opening an
 * empty transcript.
 */
export function isTranscriptViewable(status: AgentTask["status"]): boolean {
  return status !== "queued";
}

// ─── Entry labels & filter facets ───────────────────────────────────────────
// Mirrors web `trace-event-presenter.ts` (`traceEventLabel`) and
// `agent-transcript-dialog.tsx` (`getItemFilterKey` / `filterOptions`).

/**
 * Human label for one transcript entry. Tool events show the provider-native
 * tool name verbatim; prose kinds use the same fixed wording web uses
 * (`traceEventLabel` is deliberately i18n-free, so these read identically on
 * both platforms).
 */
export function transcriptEntryLabel(entry: TaskMessagePayload): string {
  switch (entry.type) {
    case "text":
      return "Agent";
    case "thinking":
      return "Thinking";
    case "tool_use":
      return entry.tool && entry.tool.length > 0 ? entry.tool : "Tool";
    case "tool_result":
      return entry.tool && entry.tool.length > 0 ? entry.tool : "Result";
    case "error":
      return "Error";
    default: {
      // All of TaskMessagePayload's types are handled above, so this branch is
      // unreachable today; it stays total for a future type widening.
      const type = entry.type as string;
      return type.length > 0 ? type : "Event";
    }
  }
}

/**
 * Web `getItemFilterKey`: a `tool_use` / `tool_result` collapses into one
 * `tool:<Name>` facet so every call to the same tool groups together; every
 * other kind is its own raw type. Entries without a tool name are keyed by
 * their type so a toolless event still filters.
 */
export function transcriptFilterKey(entry: TaskMessagePayload): string {
  return entry.tool && (entry.type === "tool_use" || entry.type === "tool_result")
    ? `tool:${entry.tool}`
    : entry.type;
}

export interface TranscriptFilterOption {
  /** Value matched against `transcriptFilterKey`. */
  key: string;
  /** Chip label — `tool:<Name>` for tool facets, else a human type label. */
  label: string;
}

/**
 * Filter chips are derived from the entries actually present — a run never
 * shows a facet it has no events for. One option per distinct key, sorted by
 * label (web sorts `filterOptions` the same way, so chip order matches).
 */
export function deriveTranscriptFilterOptions(
  entries: readonly TaskMessagePayload[],
): TranscriptFilterOption[] {
  const options = new Map<string, string>();
  for (const entry of entries) {
    const key = transcriptFilterKey(entry);
    if (options.has(key)) continue;
    const isTool =
      !!entry.tool && (entry.type === "tool_use" || entry.type === "tool_result");
    options.set(key, isTool ? key : transcriptEntryLabel(entry));
  }
  return Array.from(options, ([key, label]) => ({ key, label })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

/**
 * Drop selected keys that the current transcript has no option for. Web keeps
 * its persisted selection as-is and resolves it against the derived options on
 * every open, so a stale facet simply no-ops instead of blanking the list; the
 * mobile selection is per-open, but the same resolution keeps the two in step.
 */
export function resolveActiveFilterKeys(
  selectedKeys: readonly string[],
  options: readonly TranscriptFilterOption[],
): string[] {
  const known = new Set(options.map((option) => option.key));
  return selectedKeys.filter((key) => known.has(key));
}

/**
 * Strict filter (web parity): an empty selection filters nothing; otherwise
 * only entries whose exact facet key is selected survive. A key that matches
 * no entry therefore yields an empty list, not the whole transcript.
 */
export function filterTranscriptEntries(
  entries: readonly TaskMessagePayload[],
  selectedKeys: readonly string[],
): TaskMessagePayload[] {
  if (selectedKeys.length === 0) return [...entries];
  const active = new Set(selectedKeys);
  return entries.filter((entry) => active.has(transcriptFilterKey(entry)));
}

// ─── Sort direction ─────────────────────────────────────────────────────────

/**
 * Mobile names the chronological end "oldest first" (the dialog's two i18n
 * labels); web's store calls the same value `"chronological"`.
 */
export type TranscriptSortDirection = "oldest_first" | "newest_first";

/**
 * Reversal is a pure presentation concern — the underlying message order (and
 * each entry's `seq`) is untouched, matching web's `displayItems`. Always
 * returns a new array so callers never mutate query data.
 */
export function sortTranscriptEntries(
  entries: readonly TaskMessagePayload[],
  direction: TranscriptSortDirection,
): TaskMessagePayload[] {
  return direction === "newest_first" ? [...entries].reverse() : [...entries];
}

// ─── Per-entry copy ─────────────────────────────────────────────────────────

/**
 * Tool output is persisted JSON-encoded, so a result arrives as a quoted string
 * whose newlines are escaped. Decode exactly one layer so it reads as the
 * terminal output it was; anything else is returned untouched. Mirrors web
 * `unwrapToolOutput`.
 */
export function unwrapToolOutput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return raw;
  }
  try {
    const decoded: unknown = JSON.parse(trimmed);
    return typeof decoded === "string" ? decoded : raw;
  } catch {
    return raw;
  }
}

/**
 * Full, untruncated text for one entry's copy action — the complete body, not
 * the one-line row summary. Mirrors web `traceEventCopyText`: an RFC 3339
 * timestamp prefixes the line when the entry has one, then the label in
 * brackets, so a pasted excerpt keeps its provenance.
 */
export function transcriptEntryCopyText(entry: TaskMessagePayload): string {
  const label = transcriptEntryLabel(entry);
  let body: string;
  switch (entry.type) {
    case "tool_use":
      body = entry.input ? JSON.stringify(entry.input, null, 2) : "";
      break;
    case "tool_result":
      body = unwrapToolOutput(entry.output ?? "");
      break;
    default:
      body = entry.content ?? "";
  }
  const date = entry.created_at ? new Date(entry.created_at) : null;
  const timestamp =
    date && !Number.isNaN(date.getTime()) ? `[${date.toISOString()}] ` : "";
  return body ? `${timestamp}[${label}] ${body}` : `${timestamp}[${label}]`;
}

// ─── Diff ───────────────────────────────────────────────────────────────────
// Port of web `trace-event-presenter.ts`'s diff builders. Diff content is shown
// as +/-/context rows instead of two escaped string literals, so an edit reads
// like the file it changed.

export type TranscriptDiffLineKind = "add" | "remove" | "context" | "gap";

export interface TranscriptDiffLine {
  kind: TranscriptDiffLineKind;
  text: string;
  /** Number of context lines a `gap` stands in for. Absent on other kinds. */
  hidden?: number;
}

/** An empty body is zero lines, not one blank line — a pure deletion has no `+`. */
function toLines(value: string): string[] {
  return value.length === 0 ? [] : value.split("\n");
}

// Above this product the LCS table costs more than the readability is worth, so
// the change degrades to a plain replacement block instead of a minimal diff.
const MAX_DIFF_CELLS = 250_000;

/** Minimal line diff. Removals precede additions inside a change block. */
export function diffTranscriptLines(
  before: readonly string[],
  after: readonly string[],
): TranscriptDiffLine[] {
  const n = before.length;
  const m = after.length;
  const out: TranscriptDiffLine[] = [];

  if (n * m > MAX_DIFF_CELLS) {
    for (const text of before) out.push({ kind: "remove", text });
    for (const text of after) out.push({ kind: "add", text });
    return out;
  }

  // Flat (n+1) x (m+1) table: lcs[i][j] is the longest common subsequence of
  // before[i:] and after[j:]. Typed-array cells stay `number` under
  // noUncheckedIndexedAccess, and one allocation beats n+1 of them.
  const width = m + 1;
  const lcs = new Int32Array((n + 1) * width);
  const at = (i: number, j: number): number => lcs[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        before[i] === after[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const beforeLine = before[i] ?? "";
    const afterLine = after[j] ?? "";
    if (beforeLine === afterLine) {
      out.push({ kind: "context", text: beforeLine });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ kind: "remove", text: beforeLine });
      i++;
    } else {
      out.push({ kind: "add", text: afterLine });
      j++;
    }
  }
  while (i < n) out.push({ kind: "remove", text: before[i++] ?? "" });
  while (j < m) out.push({ kind: "add", text: after[j++] ?? "" });
  return out;
}

/** Context lines kept either side of a change before a run is collapsed. */
const DIFF_CONTEXT_LINES = 3;

/**
 * Collapse long unchanged stretches into a single `gap` row, so a one-line
 * change inside a large `old_string` is not buried in context that never moved.
 * Runs short enough that collapsing would not save a line are left alone.
 */
export function collapseTranscriptDiffContext(
  lines: readonly TranscriptDiffLine[],
  contextLines: number = DIFF_CONTEXT_LINES,
): TranscriptDiffLine[] {
  const out: TranscriptDiffLine[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (line.kind !== "context") {
      out.push(line);
      index++;
      continue;
    }

    let end = index;
    while (end < lines.length && lines[end]?.kind === "context") end++;
    const run = lines.slice(index, end);
    // A leading/trailing run only needs context on the side facing a change.
    const head = index === 0 ? 0 : contextLines;
    const tail = end === lines.length ? 0 : contextLines;

    if (run.length <= head + tail + 1) {
      out.push(...run);
    } else {
      out.push(...run.slice(0, head));
      out.push({ kind: "gap", text: "", hidden: run.length - head - tail });
      out.push(...run.slice(run.length - tail));
    }
    index = end;
  }
  return out;
}

/**
 * Parse a ready-made unified diff into rows. Hunk headers become `gap` rows —
 * exactly what they denote (skipped, unchanged content). File headers are only
 * stripped ahead of the first hunk: past that point `---` / `+++` are ordinary
 * changed lines. Mirrors web `parseUnifiedDiff`.
 */
export function parseUnifiedTranscriptDiff(diff: string): TranscriptDiffLine[] {
  const raw = diff.split("\n");
  // `split` on a trailing newline yields a phantom final element; a genuinely
  // empty trailing context line would have been " ", not "".
  if (raw.length > 0 && raw[raw.length - 1] === "") raw.pop();

  const out: TranscriptDiffLine[] = [];
  let inHunk = false;
  for (const line of raw) {
    if (line.startsWith("@@")) {
      inHunk = true;
      out.push({ kind: "gap", text: line });
      continue;
    }
    if (!inHunk) {
      if (
        line.startsWith("diff --git") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line === "---" ||
        line === "+++"
      ) {
        continue;
      }
    }
    // "\ No newline at end of file" is metadata, not a line of the file.
    if (line.startsWith("\\")) continue;
    if (line.startsWith("+")) {
      out.push({ kind: "add", text: line.slice(1) });
      continue;
    }
    if (line.startsWith("-")) {
      out.push({ kind: "remove", text: line.slice(1) });
      continue;
    }
    if (line.startsWith(" ")) {
      out.push({ kind: "context", text: line.slice(1) });
      continue;
    }
    // Tolerate a context line that lost its leading space rather than dropping
    // content on the floor.
    out.push({ kind: "context", text: line });
  }
  return out;
}

/**
 * File extension to a Shiki language id the mobile highlighter actually
 * carries (`lib/markdown/shiki.ts`). Unlisted extensions resolve to undefined
 * and render as plain monospace — a miss degrades, never errors. Web's
 * `languageForPath` maps to lowlight grammars; this mirrors the mapping for
 * the languages both engines share.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: "bash",
  cjs: "javascript",
  go: "go",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  ts: "typescript",
  tsx: "tsx",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

/** Grammar for a path, by extension. Undefined means "highlight as plaintext". */
export function languageForPath(path: string): string | undefined {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return LANGUAGE_BY_EXTENSION[base.slice(dot + 1).toLowerCase()];
}

export type TranscriptDiffDetail =
  | { kind: "diff"; path: string; lines: TranscriptDiffLine[] }
  | { kind: "file"; path: string; text: string; lineCount: number };

/**
 * Structured body for a `tool_use` entry, or null when the call is not a file
 * mutation (then the row falls back to pretty JSON). A replacement reads as a
 * diff; a whole-file write reads as plain content, because nothing was
 * compared — marking all of it `+` adds noise, not information. Mirrors web
 * `traceEventDetail`'s diff/file branches.
 */
export function transcriptDiffDetail(
  entry: TaskMessagePayload,
): TranscriptDiffDetail | null {
  if (entry.type !== "tool_use" || !entry.input) return null;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const path = str(entry.input.file_path) ?? str(entry.input.path);
  if (path === null) return null;

  const oldString = str(entry.input.old_string);
  const newString = str(entry.input.new_string);
  if (oldString !== null && newString !== null) {
    return {
      kind: "diff",
      path,
      lines: collapseTranscriptDiffContext(
        diffTranscriptLines(toLines(oldString), toLines(newString)),
      ),
    };
  }

  // Keyed on `content`, not on "the before side is empty": an edit whose
  // old_string is empty is an insertion, which still reads best as a diff.
  const content = str(entry.input.content);
  if (content !== null) {
    return { kind: "file", path, text: content, lineCount: toLines(content).length };
  }
  return null;
}
