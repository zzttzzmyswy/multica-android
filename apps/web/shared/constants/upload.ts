/**
 * Upload file type configuration.
 *
 * Aligned with what Claude Code agents can natively read:
 * - Images: multimodal vision (Read tool)
 * - PDF: Read tool (max 20 pages at a time)
 * - Text/code: Read tool (plain text)
 * - JSON: Read tool (plain text)
 *
 * NOT supported (Agent can't read):
 * - Video/audio: Claude has no AV processing
 * - Office binary (.docx/.xlsx): needs conversion tools
 * - Arbitrary binaries: no use case
 */

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/** MIME patterns — exact match or wildcard (e.g. "text/*") */
export const ALLOWED_MIME_PATTERNS: readonly string[] = [
  // Images (Agent: multimodal vision)
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Documents (Agent: Read tool)
  "application/pdf",
  // Text & code (Agent: Read tool, plain text)
  "text/*",
  // Structured data (Agent: Read tool)
  "application/json",
];

/**
 * HTML accept attribute value for <input type="file">.
 * Must mirror ALLOWED_MIME_PATTERNS for browser-level filtering.
 */
export const FILE_INPUT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/*",
  "application/json",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".rb",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".sh",
  ".ipynb",
].join(",");

/** Check if a MIME type matches our allowed patterns. */
export function isAllowedFileType(mimeType: string): boolean {
  const ct = mimeType.toLowerCase();
  return ALLOWED_MIME_PATTERNS.some((pattern) => {
    if (pattern.endsWith("/*")) {
      return ct.startsWith(pattern.slice(0, -1));
    }
    return ct === pattern;
  });
}
