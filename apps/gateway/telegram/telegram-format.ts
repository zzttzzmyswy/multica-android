/**
 * Markdown → Telegram HTML converter.
 *
 * Telegram supports a subset of HTML:
 *   <b>, <i>, <u>, <s>, <code>, <pre>, <a href="...">, <blockquote>
 *
 * Strategy:
 * 1. Extract code blocks (protect from further processing)
 * 2. Convert Markdown tables to vertical list format
 * 3. Extract inline code
 * 4. Escape HTML entities in remaining text
 * 5. Convert Markdown syntax to HTML tags
 * 6. Restore code blocks
 */

/**
 * Parse a Markdown table row into trimmed cell values.
 * e.g. "| A | B | C |" → ["A", "B", "C"]
 */
function parseTableRow(line: string): string[] {
  const cells = line.split("|").map((c) => c.trim());
  // Remove empty first/last elements from leading/trailing |
  if (cells.length >= 2 && cells[0] === "") cells.shift();
  if (cells.length >= 1 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/** Check if a line is a Markdown table separator (|---|---|) */
function isTableSeparator(line: string): boolean {
  return /^\s*\|[\s\-:]+(\|[\s\-:]+)*\|\s*$/.test(line);
}

/**
 * Convert a block of Markdown table lines into a vertical list format.
 *
 * Input:
 *   | Name   | Code | Type       |
 *   |--------|------|------------|
 *   | Slack  | WORK | Messaging  |
 *   | Notion | 私有 | Docs       |
 *
 * Output:
 *   • **Slack**
 *     Code: WORK
 *     Type: Messaging
 *
 *   • **Notion**
 *     Code: 私有
 *     Type: Docs
 */
function convertTableBlock(tableLines: string[]): string {
  if (tableLines.length < 2) return tableLines.join("\n");

  const headers = parseTableRow(tableLines[0]!);
  if (headers.length === 0) return tableLines.join("\n");

  // Skip separator row if present
  let dataStart = 1;
  if (tableLines[1] && isTableSeparator(tableLines[1])) {
    dataStart = 2;
  }

  if (dataStart >= tableLines.length) return tableLines.join("\n");

  const rows: string[] = [];
  for (let i = dataStart; i < tableLines.length; i++) {
    const cells = parseTableRow(tableLines[i]!);
    if (cells.length === 0) continue;

    const parts: string[] = [];
    // First column as bold title — strip existing ** to avoid double-wrapping
    const title = cells[0]!.replace(/^\*+|\*+$/g, "");
    parts.push(`**${title}**`);
    // Remaining columns as "Header: Value"
    for (let j = 1; j < Math.min(headers.length, cells.length); j++) {
      const val = cells[j]?.trim();
      if (val) {
        parts.push(`  ${headers[j]}: ${val}`);
      }
    }
    rows.push(parts.join("\n"));
  }

  return rows.join("\n\n");
}

/**
 * Convert all Markdown tables in text to vertical list format.
 * Tables are detected as consecutive lines starting with |.
 */
function convertMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i]!.trimStart().startsWith("|")) {
      // Collect consecutive table lines
      const tableLines: string[] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith("|")) {
        tableLines.push(lines[i]!);
        i++;
      }
      result.push(convertTableBlock(tableLines));
    } else {
      result.push(lines[i]!);
      i++;
    }
  }

  return result.join("\n");
}

/** Escape HTML special characters */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert Markdown text to Telegram-compatible HTML.
 * Handles: bold, italic, strikethrough, inline code, code blocks, links, blockquotes.
 */
export function markdownToTelegramHtml(markdown: string): string {
  // Placeholder system: replace code blocks/inline code with placeholders,
  // process markdown on the rest, then restore.
  const placeholders: string[] = [];
  const placeholder = (content: string): string => {
    const idx = placeholders.length;
    placeholders.push(content);
    return `\x00PH${idx}\x00`;
  };

  let text = markdown;

  // 1. Fenced code blocks: ```lang\n...\n```
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const escaped = escapeHtml(code.replace(/\n$/, ""));
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    return placeholder(`<pre><code${langAttr}>${escaped}</code></pre>`);
  });

  // 2. Convert Markdown tables to vertical list format (before further processing)
  text = convertMarkdownTables(text);

  // 3. Inline code: `...`
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    return placeholder(`<code>${escapeHtml(code)}</code>`);
  });

  // 4. Escape HTML in remaining text
  text = escapeHtml(text);

  // 5. Links: [text](url) — escape quotes in URL to prevent attribute breakout
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) =>
    `<a href="${url.replace(/"/g, "&quot;")}">${label}</a>`,
  );

  // 6. Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");

  // 7. Italic: *text* or _text_ (but not inside words with underscores)
  text = text.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, "<i>$1</i>");
  text = text.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, "<i>$1</i>");

  // 8. Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 9. Blockquotes: > text (at line start)
  text = text.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  // Merge adjacent blockquotes
  text = text.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // 10. Headings: strip # markers, make bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Restore placeholders
  text = text.replace(/\x00PH(\d+)\x00/g, (_match, idx: string) => placeholders[Number(idx)]!);

  return text;
}
