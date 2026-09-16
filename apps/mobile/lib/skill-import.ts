/**
 * Create-skill method + import helpers, extracted as pure functions so the
 * URL-source detection, form gating and runtime multi-select maths are
 * unit-testable without a device.
 *
 * Mirrors web:
 *   - `MethodChooser` / the `Method` union: packages/views/skills/components/
 *     create-skill-dialog.tsx:46 (`chooser | manual | url | runtime`).
 *   - `detectUrlSource` + `SourceCard`: same file :243-280 — the detected
 *     source only paints the active source card and picks the importing
 *     label; the server owns real URL validation, so the only client gate is
 *     a non-empty trimmed URL (the import button's `disabled`).
 *   - `isNameConflictError`: packages/views/skills/lib/utils.ts — the 409
 *     shape that earns the "already exists, rename it" hint.
 *   - `RuntimeLocalSkillImportPanel` selection maths: packages/views/skills/
 *     components/runtime-local-skill-import-panel.tsx:627-665 (`toggleSkill`,
 *     `toggleAll` — select-all/none operates on the VISIBLE (filtered) rows
 *     only, so a search narrows what "all" means).
 */

/** The three create paths web offers; `chooser` is the landing state. */
export type SkillCreateMethod = "chooser" | "manual" | "url" | "runtime";

/** Hosted sources the URL import understands (order = card order on web). */
export const SKILL_IMPORT_SOURCES = ["clawhub", "skills_sh", "github"] as const;
export type SkillImportSource = (typeof SKILL_IMPORT_SOURCES)[number];

/** Example host shown on each source card (web `exampleHost`). */
export const SKILL_SOURCE_EXAMPLE_HOST: Record<SkillImportSource, string> = {
  clawhub: "clawhub.ai/owner/skill",
  skills_sh: "skills.sh/owner/repo/skill",
  github: "github.com/owner/repo",
};

/** Where a source card's link opens (web `browseUrl`). */
export const SKILL_SOURCE_BROWSE_URL: Record<SkillImportSource, string> = {
  clawhub: "https://clawhub.ai",
  skills_sh: "https://skills.sh",
  github: "https://github.com",
};

/** i18n key for each source's display label (flat keys — see lib/i18n). */
export const SKILL_SOURCE_LABEL_KEY: Record<SkillImportSource, string> = {
  clawhub: "skills.import.sourceClawhub",
  skills_sh: "skills.import.sourceSkillsSh",
  github: "skills.import.sourceGithub",
};

/**
 * Which hosted source a URL looks like it targets. Substring matching, not
 * URL parsing — this only drives the active-card highlight, and web does the
 * same (`u.includes(...)`), so a URL that merely mentions the host still
 * lights the card up.
 */
export function detectSkillImportSource(url: string): SkillImportSource | null {
  const normalized = url.trim().toLowerCase();
  if (normalized.includes("clawhub.ai")) return "clawhub";
  if (normalized.includes("skills.sh")) return "skills_sh";
  if (normalized.includes("github.com")) return "github";
  return null;
}

/**
 * The URL form's only client-side gate — web disables import on
 * `!url.trim()`. Anything richer would reject URLs the server accepts.
 */
export function skillImportUrlReady(url: string): boolean {
  return url.trim().length > 0;
}

/**
 * Whether a create/import failure is a name collision. Web appends the
 * "rename it" hint for these; matched loosely because the message comes from
 * the server (mirrors packages/views/skills/lib/utils.ts).
 */
export function isNameConflictError(message: string): boolean {
  return /\b(409|conflict|already exists|unique constraint)\b/i.test(message);
}

/** Immutable single-key toggle for the runtime skill checklist. */
export function toggleSkillKey(
  selected: ReadonlySet<string>,
  key: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Whether every visible row is currently selected (drives "select all"). */
export function allSkillKeysSelected(
  selected: ReadonlySet<string>,
  visibleKeys: readonly string[],
): boolean {
  return (
    visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key))
  );
}

/**
 * Select-all / clear-all over the VISIBLE rows. Rows hidden by the search
 * keep their prior selection — narrowing the filter must never silently drop
 * a pick the user made before typing.
 */
export function toggleVisibleSkillKeys(
  selected: ReadonlySet<string>,
  visibleKeys: readonly string[],
): Set<string> {
  const next = new Set(selected);
  if (allSkillKeysSelected(selected, visibleKeys)) {
    for (const key of visibleKeys) next.delete(key);
  } else {
    for (const key of visibleKeys) next.add(key);
  }
  return next;
}

/** Per-skill outcome of a runtime-local bulk import. */
export type SkillImportOutcome = "created" | "updated" | "skipped" | "failed";

export interface SkillImportOutcomeRow {
  /** Runtime-local skill key (stable identity within a runtime). */
  key: string;
  /** Display name shown in the summary. */
  name: string;
  outcome: SkillImportOutcome;
  /** Server message for skipped/failed rows. */
  error?: string;
}

export interface SkillImportSummary {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  /** Rows that need the user's attention, in input order. */
  problems: SkillImportOutcomeRow[];
}

/**
 * Roll a bulk import's per-skill results up into the summary counts web shows
 * (`BulkImportSummary`). Every row lands in exactly one bucket, so the four
 * counts always sum to `results.length`.
 */
export function summarizeSkillImportResults(
  results: readonly SkillImportOutcomeRow[],
): SkillImportSummary {
  const summary: SkillImportSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    problems: [],
  };
  for (const row of results) {
    summary[row.outcome] += 1;
    if (row.outcome === "failed" || row.outcome === "skipped") {
      summary.problems.push(row);
    }
  }
  return summary;
}
