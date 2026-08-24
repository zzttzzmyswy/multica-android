/**
 * Pure model for the "CLI 参数" (custom args) editor on the agent detail
 * page. Mirrors the web-side editing logic in
 * `packages/views/agents/components/tabs/custom-args-tab.tsx` — the same
 * list → entries round-trip, the same trim/blank filtering, the same
 * JSON-array dirty comparison (order-sensitive: argv order matters), and
 * the same launch-command preview (quoting args that contain whitespace,
 * exactly like web's `formatArgForPreview`).
 *
 * Entry ids are a module-local counter, NOT createSafeId — that util needs
 * crypto.getRandomValues which is unavailable on the RN runtime (MYS-683).
 */
export interface ArgEntry {
  id: string;
  value: string;
}

let nextEntryId = 0;

/** Web `argsToEntries` — one entry per raw arg. */
export function argsToEntries(args: string[]): ArgEntry[] {
  return args.map((value) => ({ id: String(nextEntryId++), value }));
}

/** Fresh id for a user-added row (module-local counter). */
export function freshArgEntryId(): string {
  return String(nextEntryId++);
}

/** Web `entriesToArgs` — trim + drop blanks, preserve order. */
export function entriesToArgs(entries: ArgEntry[]): string[] {
  return entries.map((entry) => entry.value.trim()).filter(Boolean);
}

/**
 * Web dirty check: JSON-stringify of the *normalised* args vs the stored
 * args. Array order is significant (argv order is significant), so a
 * reorder counts as dirty.
 */
export function customArgsDirty(current: string[], original: string[]): boolean {
  return JSON.stringify(current) !== JSON.stringify(original);
}

/** Web `formatArgForPreview` — wrap args that contain whitespace in JSON
 *  quotes so the preview reads like a real argv line. Not used for the
 *  stored value (the raw string is saved). */
export function formatArgForPreview(value: string): string {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

/**
 * The launch command the preview shows: `<launchHeader> <arg1> <arg2> …`.
 * Returns null when the runtime has no launch header (web renders no
 * preview section in that case).
 */
export function launchPreview(
  launchHeader: string | null | undefined,
  args: string[],
): string | null {
  if (!launchHeader) return null;
  const tail = args.map(formatArgForPreview).join(" ");
  return tail ? `${launchHeader} ${tail}` : launchHeader;
}