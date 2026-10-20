/**
 * The project chip on an issue row — mobile surface of web's `showProject`
 * slot in `packages/views/issues/components/list-row.tsx:60、:151-156`:
 *
 *   const showProject = storeProperties.project && project;
 *   …
 *   {showProject && (<ProjectIcon …/> <span>{project.title}</span>)}
 *
 * Web's row receives the resolved project as a prop (`list-view.tsx:483`,
 * `:492` — `issue.project_id ? projectMap?.get(issue.project_id) : undefined`)
 * and draws nothing when it cannot resolve one. Mobile had no project slot at
 * all on any list-style surface, so a user reading the workspace list could
 * not tell which project a task belonged to without opening it (MYS-2255).
 *
 * Three decisions this module owns, kept pure so they are testable without a
 * renderer:
 *
 * 1. **Gate on the issue's own `project_id`, never on the catalog.** A row
 *    whose issue has no project must draw nothing regardless of what the
 *    project list contains — web's conjunction starts with `project`, which
 *    can only be truthy when `issue.project_id` is.
 *
 * 2. **"Unresolved" is not "no project".** Web drops the chip while its
 *    project map is absent, and so must mobile: the catalog is a separate
 *    query that is `[]` both before it answers and when the workspace really
 *    has no projects. Drawing nothing is the right pixel in every unresolved
 *    case — the chip is additive, so its absence asserts nothing. This is the
 *    same rule the `cardProperties` docs state for the display toggles, and
 *    the one 254–257 established for actor names: a surface may stay silent,
 *    it may not invent a fact.
 *
 *    A `gone` project (the id resolves to nothing after the catalog settled)
 *    is ALSO silent rather than a "deleted project" placeholder: web drops it
 *    too, and a row is not the place to explain that a project was archived.
 *
 * 3. **The display toggle gates the chip, and its default is ON.** Web's
 *    `cardProperties.project` defaults to `true` (`view-store.ts:287-296`), so
 *    a user who never opened the Display panel sees project chips. Mobile's
 *    `issues-filter.tsx` currently offers only five toggles and `project` is
 *    not one of them — see the note there; the gate is read anyway so the
 *    surface behaves correctly the moment the toggle is exposed.
 */
import type { Issue } from "@multica/core/types";
import type { CardProperties } from "@/data/stores/issue-filter-slice";

/** The one project shape a row needs. Structural so the table, the board and
 *  the list can each pass their own read without a shared nominal type. */
export interface RowProject {
  id: string;
  title: string;
  icon?: string | null;
}

export interface RowProjectChip {
  title: string;
  icon: string | null;
}

/**
 * The chip a row should draw, or `null` for "draw nothing".
 *
 * `project` is the catalog row the caller managed to resolve for
 * `issue.project_id` — `null`/`undefined` covers both "the issue has none" and
 * "the catalog has not answered", and both mean no chip.
 */
export function issueRowProjectChip({
  issue,
  project,
  cardProperties,
}: {
  issue: Pick<Issue, "project_id">;
  project: RowProject | null | undefined;
  /** The hosting surface's display toggles. Omitted means "all on", matching
   *  the board card's own default (web's view-store default is on for every
   *  key). */
  cardProperties?: CardProperties;
}): RowProjectChip | null {
  if (!issue.project_id) return null;
  if (!project) return null;
  if (project.id !== issue.project_id) return null;
  // Only an explicit `false` turns the field off — the same per-key rule
  // `sanitizeCardProperties` applies on the read side, so a view that predates
  // the key keeps its chips.
  if (cardProperties && cardProperties.project === false) return null;
  const title = project.title.trim();
  // A project with a blank title would render an icon and no label: web's
  // `project.title` is a required string, so this only guards hand-built or
  // half-migrated rows. Nothing to say means nothing to draw.
  if (title.length === 0) return null;
  return { title, icon: project.icon ?? null };
}

/**
 * Resolve `issue.project_id` against a project catalog by id — the mobile
 * equivalent of web's `projectMap?.get(issue.project_id)`
 * (`list-view.tsx:485`).
 *
 * Deliberately NOT a `Map`: the three list surfaces already hold their project
 * list as an array (each renders it elsewhere too — the filter chips read the
 * same query), and on a phone-sized workspace a linear scan over a few dozen
 * rows per visible row is cheaper than building and invalidating a map on
 * every catalog identity change.
 *
 * `null` means "draw nothing": the issue has no project, OR the catalog has
 * not answered, OR the id is no longer in it. All three collapse here on
 * purpose — `issueRowProjectChip` is where the decision is explained.
 */
export function findRowProject(
  projects: readonly RowProject[] | undefined,
  projectId: string | null | undefined,
): RowProject | null {
  if (!projectId || !projects) return null;
  return projects.find((p) => p.id === projectId) ?? null;
}
