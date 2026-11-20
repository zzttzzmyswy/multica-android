/** Match the full phrase first, then individual terms, as the web palette does. */
export function searchHighlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const phrase = query.trim();
  if (!phrase) return [{ text, hit: false }];
  const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [...new Set([phrase, ...phrase.split(/\s+/)])].map(escape);
  const pattern = new RegExp(patterns.join("|"), "gi");
  const parts: { text: string; hit: boolean }[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    if (start > end) parts.push({ text: text.slice(end, start), hit: false });
    parts.push({ text: match[0], hit: true });
    end = start + match[0].length;
  }
  if (end < text.length) parts.push({ text: text.slice(end), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}
