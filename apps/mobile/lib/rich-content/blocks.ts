/**
 * Fenced-code rich-block dispatch — the ONLY place that decides whether a
 * fenced code block upgrades to a rich block (Mermaid diagram / HTML
 * preview) or stays plain highlighted source.
 *
 * Mirrors web's `isRichFenceLanguage` (packages/views/rich-content/rich-code-block.tsx):
 * dispatch is on a WHOLE language token, never a substring — `mermaidx` and
 * `htmlbars` are ordinary code, not a diagram / preview.
 */
export type RichFenceKind = "mermaid" | "html";

export function richFenceKind(lang: string | undefined): RichFenceKind | null {
  if (lang === "mermaid") return "mermaid";
  if (lang === "html") return "html";
  return null;
}