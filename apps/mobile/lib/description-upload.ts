/**
 * Pure string helpers for the issue-description image / file upload buttons
 * (web content-editor parity). No state, no RN — testable in the vitest
 * node lane alongside `markdown-insert.ts`.
 *
 * The markdown URL choice mirrors core's `pickMarkdownLink`
 * (`packages/core/hooks/use-file-upload.ts`): prefer the server-provided
 * durable `markdown_url` (MUL-3192 contract), fall back to `url` for
 * backends / avatar branches that predate it. Mobile's markdown renderer
 * resolves both shapes (`resolveAttachmentUrl`).
 */
export interface UploadLinkInput {
  url: string;
  markdown_url?: string | null;
  filename: string;
}

export function pickAttachmentMarkdownUrl(att: UploadLinkInput): string {
  return att.markdown_url ? att.markdown_url : att.url;
}

export function imageInsertMarkdown(markdownUrl: string): string {
  return `![](${markdownUrl})`;
}

export function fileInsertMarkdown(filename: string, markdownUrl: string): string {
  return `[${filename}](${markdownUrl})`;
}