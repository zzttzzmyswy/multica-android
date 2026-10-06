/**
 * Agent-create runtime picker logic — the phone mirror of web
 * `packages/views/agents/components/runtime-picker.tsx`. Kept React-free so the
 * Node vitest lane can pin the parts a markup guard cannot see: which runtimes
 * each scope shows, what a search narrows to, which empty state is on screen,
 * and — the part that breaks silently — which runtime the form ends up selected
 * on after a scope toggle.
 *
 * The shipped defect this replaces: the sheet consumed an already-filtered
 * `usableRuntimes()` list, so a runtime the viewer may not use (somebody else's
 * private machine) or an offline one was not merely locked but absent. Web keeps
 * those rows in the list, greyed and locked, which is the only way the viewer
 * learns the machine exists and who to ask. The picker therefore consumes the
 * FULL list; `usableRuntimes()` stays the source of the *default selection*
 * only, never of the visible set.
 *
 * Two predicates live here and must not be collapsed into one:
 *  - `isRuntimeRowLocked` is the ACCESS rule (`isRuntimeUsableForUser` alone,
 *    exactly what web applies to a row). An offline runtime the viewer owns is
 *    NOT locked — the binding has to stay honest and re-choosable in edit mode.
 *  - `firstUsableRuntimeId` is the DEFAULT-SELECTION rule: online AND usable,
 *    i.e. `usableRuntimes()`. Mobile pre-dates web in refusing to auto-select a
 *    runtime that cannot execute anything; this iteration keeps that and only
 *    stops it from shaping the visible list.
 */
import { isRuntimeUsableForUser } from "@multica/core/runtimes";
import type { RuntimeDevice } from "@multica/core/types";
import { usableRuntimes } from "./agent-create";
import {
  buildRuntimeMachines,
  filterRuntimeMachines,
  type RuntimeMachine,
} from "./runtime-machines";

export type RuntimeFilter = "mine" | "all";

/**
 * Above this many runtimes the flat list stops being scannable, so the sheet
 * surfaces a search box. Same threshold as web (`SEARCH_THRESHOLD = 6`), and
 * measured against the FULL list — matching web, where the box appears from the
 * workspace's runtime count rather than the current scope's.
 */
export const RUNTIME_SEARCH_THRESHOLD = 6;

/**
 * Whether the scope toggle has anything to switch between. A viewer who owns
 * every runtime gains nothing from the tabs, so they stay hidden — the same gate
 * as web's `hasOtherRuntimes`.
 */
export function hasOtherRuntimes(
  runtimes: RuntimeDevice[],
  currentUserId: string | null,
): boolean {
  return runtimes.some((runtime) => runtime.owner_id !== currentUserId);
}

/**
 * The scope's runtime list, own-first then usable-first. Drives both the
 * rendered machines and the auto-selection below them; deliberately independent
 * of the search box, so typing narrows the view without ever moving the form's
 * selection — web keeps the same split.
 */
export function computeFilteredRuntimes(
  runtimes: RuntimeDevice[],
  filter: RuntimeFilter,
  currentUserId: string | null,
): RuntimeDevice[] {
  const scoped =
    filter === "mine" && currentUserId
      ? runtimes.filter((runtime) => runtime.owner_id === currentUserId)
      : runtimes;
  return [...scoped].sort((a, b) => {
    const aMine = a.owner_id === currentUserId;
    const bMine = b.owner_id === currentUserId;
    if (aMine !== bMine) return aMine ? -1 : 1;
    const aUsable = isRuntimeUsableForUser(a, currentUserId);
    const bUsable = isRuntimeUsableForUser(b, currentUserId);
    if (aUsable !== bUsable) return aUsable ? -1 : 1;
    return 0;
  });
}

/**
 * The runtime the form falls back to after a scope switch — the first of the new
 * scope that is actually runnable, or null when the scope holds none. Both the
 * toggle and the guards read this, so "what does the form select after
 * switching" has exactly one answer, and it is always a runtime the create gate
 * will accept.
 */
export function firstUsableRuntimeId(
  runtimes: RuntimeDevice[],
  currentUserId: string | null,
): string | null {
  return usableRuntimes(runtimes, currentUserId)[0]?.id ?? null;
}

/**
 * The scoped, searched machine groups the sheet renders. Search narrows
 * MACHINES, not rows: a machine matching by title, device, daemon or any of its
 * runtimes is kept whole — the same granularity as web, so a hit never truncates
 * the group it belongs to.
 */
export function pickerMachines(
  runtimes: RuntimeDevice[],
  options: {
    filter: RuntimeFilter;
    search: string;
    currentUserId: string | null;
    now: number;
  },
): RuntimeMachine[] {
  const machines = buildRuntimeMachines(
    computeFilteredRuntimes(runtimes, options.filter, options.currentUserId),
    { now: options.now, currentUserId: options.currentUserId },
  );
  return filterRuntimeMachines(machines, options.search, "all");
}

/**
 * Whether a row is locked. Access only: web applies `isRuntimeUsableForUser`
 * alone, so an offline runtime the viewer owns stays pickable — in edit mode the
 * current binding must remain an honest, re-choosable option. Offline-ness is
 * carried by the row's status dot instead, which is why the two must not be
 * merged.
 */
export function isRuntimeRowLocked(
  runtime: RuntimeDevice,
  currentUserId: string | null,
): boolean {
  return !isRuntimeUsableForUser(runtime, currentUserId);
}

/**
 * Which empty state the sheet is in, so the message can name the real cause.
 *
 * Three cases, and conflating them is a defect of its own: an empty workspace
 * has no runtime to offer at all, a search that matched nothing needs the query
 * loosened, and an empty scope needs the OTHER scope. Telling a member who owns
 * no runtime "no matching machines" sends them hunting for a search box instead
 * of reaching for the toggle beside it — reachable on every first visit, since
 * the sheet opens on "mine".
 */
export type PickerEmptyState = "none" | "search" | "scope";

export function pickerEmptyState(
  runtimes: RuntimeDevice[],
  machines: RuntimeMachine[],
  search: string,
): PickerEmptyState | null {
  if (machines.length > 0) return null;
  if (runtimes.length === 0) return "none";
  return search.trim() ? "search" : "scope";
}
