/**
 * Filename → Shiki language for the inline text-attachment preview.
 *
 * Mirrors web's `EXT_LANGUAGE_MAP` / `extensionToLanguage`
 * (`packages/views/editor/utils/preview.ts:15-45`), narrowed to the grammars
 * this app actually bundles (`lib/markdown/shiki.ts` LANGS — bash, go,
 * javascript, json, jsx, markdown, python, rust, sql, tsx, typescript, yaml).
 *
 * The narrowing is deliberate rather than lossy. `CodeBlock` resolves this
 * through `resolveLang`, which returns null for any grammar that is not
 * bundled and falls back to plain monospace. Mapping an extension to a
 * grammar we do not ship would therefore render identically to not mapping
 * it, while claiming a capability we lack — so unmapped is the honest answer.
 *
 * Returning `undefined` is a normal outcome, not an error: the body renders
 * unhighlighted, exactly as web does for its `plaintext` entries.
 */

/** Extension (lowercase, no dot) → bundled Shiki language id. */
const EXTENSION_LANGUAGE: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  go: "go",
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  sql: "sql",
};

function basenameOf(filename: string): string {
  return (filename ?? "").toLowerCase().split(/[\\/]/).pop() ?? "";
}

function extensionOf(filename: string): string {
  const base = basenameOf(filename).split(/[?#]/, 1)[0] ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1);
}

/** Shiki language id for a filename, or undefined to render unhighlighted.
 *  Never throws: an unknown or absent extension is a normal answer. */
export function attachmentLanguage(filename: string): string | undefined {
  const ext = extensionOf(filename);
  return ext ? EXTENSION_LANGUAGE[ext] : undefined;
}
