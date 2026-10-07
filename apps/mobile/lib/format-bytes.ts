/**
 * Compact file size for UI metadata: `412 KB`, `3.2 MB`.
 *
 * Mirrors `packages/views/common/format-bytes.ts` verbatim — the same three
 * branches, so a deliverable's size reads identically on web and on the phone.
 * Mobile cannot import it (that helper lives in `packages/views`, which is not
 * on the mobile sharing whitelist — see apps/mobile/CLAUDE.md), so the rule is
 * copied rather than re-derived.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
