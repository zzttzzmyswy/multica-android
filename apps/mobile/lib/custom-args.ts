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

/**
 * Whether the custom-args page may offer — or perform — a save (MYS-1910).
 *
 * `PUT /api/agents/{id}` replaces `custom_args` wholesale rather than merging
 * (`server/pkg/db/queries/agent.sql:140`: `custom_args = COALESCE($14,
 * custom_args)`), so whatever list is on screen at save time becomes the
 * agent's entire argument list. The page seeds that list from a workspace
 * read, and when that read had failed the page used to render 「还没有参数」
 * ("No arguments yet") over an agent that genuinely had some. Following the
 * obvious next step — "add an argument" — turned `entries` non-empty, made
 * `dirty` true, enabled Save, and shipped a one-element list over the N the
 * server already held. A transient network failure was enough to silently
 * destroy every launch argument, with no audit row (unlike `custom_env`,
 * which goes through `PUT /agents/{id}/env` and is audited).
 *
 * So the gate is not "did the user change something" but "are we editing a
 * list we actually read". `dirty` is necessary and not sufficient: the list
 * must have been seeded from a resolved read of the real record.
 *
 * `readSettled` is false until the agent row has been resolved out of a read
 * that actually finished, which is exactly the condition under which
 * `originalArgs` reflects the server's truth.
 */
export function canSaveCustomArgs({
  dirty,
  readSettled,
  saving = false,
  editorOpen = false,
}: {
  dirty: boolean;
  /** The agent row came out of a *settled* read, so `originalArgs` is the
   *  server's real list. False while the read is loading or failed. */
  readSettled: boolean;
  saving?: boolean;
  editorOpen?: boolean;
}): boolean {
  return dirty && readSettled && !saving && !editorOpen;
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