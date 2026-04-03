import { preprocessLinks } from "@/components/markdown/linkify";
import { preprocessMentionShortcodes } from "@/components/markdown/mentions";

/**
 * Preprocess a markdown string before loading into Tiptap via contentType: 'markdown'.
 *
 * Two string→string transforms:
 * 1. Legacy mention shortcodes [@ id="..." label="..."] → [@Label](mention://member/id)
 * 2. Raw URLs → markdown links (so they render as clickable Link nodes)
 */
export function preprocessMarkdown(markdown: string): string {
  if (!markdown) return "";
  const step1 = preprocessMentionShortcodes(markdown);
  const step2 = preprocessLinks(step1);
  return step2;
}
