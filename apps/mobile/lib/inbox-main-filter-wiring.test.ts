/**
 * Wiring guard for the main inbox's filter entry.
 *
 * Mobile's vitest lane is Node-only (see `vitest.config.ts`) — there is no RN
 * renderer — so "the sheet takes a title and the screen passes one" cannot be
 * asserted by rendering. It is asserted here against the source instead, the
 * same way `inbox-start-date-wiring.test.ts` pins a branch no test can mount.
 *
 * What this protects is the specific shape of the bug this iteration fixes:
 * every piece of the filter layer existed and was correct on its own — the
 * store, the predicate, the counts, the sheet — and the ONLY thing missing was
 * the wiring into the main branch. A future refactor that deletes a prop or a
 * `filterInboxItems` call would leave every unit test in the suite green while
 * the phone goes back to an unfilterable inbox, which is exactly the state
 * this file exists to fail on.
 *
 * Comments are stripped before matching, so a comment quoting the wiring
 * cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");
const SCREEN = path.join(
  APP_ROOT,
  "app/(app)/[workspace]/(tabs)/inbox.tsx",
);
const SHEET = path.join(
  APP_ROOT,
  "components/inbox/inbox-archive-filter-sheet.tsx",
);

function code(abs: string): string {
  return readFileSync(abs, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The main view's `return (...)` block — everything after the archived branch. */
function mainBranch(screen: string): string {
  // The archived branch returns early on `view === "archived"`; the main view
  // is the return that follows it.
  const archivedAt = screen.indexOf('if (view === "archived")');
  expect(archivedAt).toBeGreaterThan(-1);
  const mainAt = screen.indexOf("\n  return (", archivedAt);
  expect(mainAt).toBeGreaterThan(-1);
  return screen.slice(mainAt);
}

describe("main inbox filter wiring", () => {
  const screen = code(SCREEN);
  const main = mainBranch(screen);

  it("filters the main list through the shared predicate, not just the UI", () => {
    // The acceptance criterion is that the list really narrows. A screen that
    // renders a filter trigger without a `filterInboxItems` call over its own
    // data source would show a badge and change nothing.
    expect(screen).toMatch(
      /const visibleData = useMemo\(\s*\(\) => filterInboxItems\(data, mainFilters\)/,
    );
    expect(main).toMatch(/data=\{visibleData\}/);
  });

  it("renders the sheet in BOTH view branches", () => {
    const rendered = screen.match(/<InboxArchiveFilterSheet/g) ?? [];
    expect(rendered).toHaveLength(2);
    // One of them is inside the early-returned archived branch, the other in
    // the main branch — a sheet mounted only in the archived branch is the
    // status quo this iteration fixes.
    expect(main).toMatch(/<InboxArchiveFilterSheet/);
  });

  it("opens the sheet from a trigger in the main header", () => {
    expect(main).toMatch(/onPress=\{\(\) => setFiltersOpen\(true\)\}/);
  });

  it("shows the active count on that trigger", () => {
    // Web prints the count beside the glyph (`inbox-filter-menu.tsx`), so an
    // active filter is visible without opening the sheet. The main view reads
    // the EFFECTIVE count, not the raw one: a priority selection the backend
    // cannot honour is stripped from the request, and a badge counting it
    // would advertise a filter that is not on the wire.
    expect(main).toMatch(/mainActiveFilterCount > 0/);
    expect(screen).toMatch(
      /const mainActiveFilterCount = inboxFilterCount\(mainFilters\)/,
    );
  });

  it("hands the sheet the MAIN counts, not the archive's", () => {
    // The two sources are different by design (server facets vs local counts).
    // Passing the archived query's `facets` here would print archive numbers
    // beside main-inbox rows, and on a cold open of the sheet it would print
    // nothing at all while a request it did not need went out.
    expect(main).toMatch(/facets=\{mainFacets\}/);
    expect(screen).toMatch(
      /const mainFacets = useMemo\(\s*\(\) => inboxLocalFacets\(data, mainFilters\)/,
    );
  });

  it("routes the capability probe through the priority-stripping copy", () => {
    // The probe and the strip have to be the same answer: offering a priority
    // row whose press is then dropped is worse than not offering it.
    expect(screen).toMatch(
      /const mainPrioritySupport = inboxPriorityFilterSupport\(rawMainItems\)/,
    );
    expect(screen).toMatch(
      /inboxFiltersForPrioritySupport\(filters, mainPrioritySupport\)/,
    );
    expect(main).toMatch(/prioritySupport=\{mainPrioritySupport\}/);
  });

  it("shows the sheet the effective selection, not the raw one", () => {
    // Web reads `effectiveFilters` for every checked state and every count
    // (`inbox-filter-menu.tsx:228,296`). The raw store value would draw a tick
    // in a box the request is not honouring — and with a priority the backend
    // cannot filter on, a tick beside a list that plainly did not narrow.
    expect(main).toMatch(/filters=\{mainFilters\}/);
    expect(main).not.toMatch(/filters=\{filters\}/);
  });

  it("badges the effective count on the trigger, not the raw count", () => {
    // Same reason one step out: a badge reading "1" over a list fetched with
    // no filters is the exact defect iteration 238 fixed in the archived view
    // (`archivedPriorityFilterSupport`'s doc). The main view must not
    // reintroduce it in the view that fix did not reach.
    expect(main).toMatch(/mainActiveFilterCount > 0/);
    expect(main).not.toMatch(/activeFilterCount > 0/);
  });

  it("gives the filtered-empty state its own copy and a way out", () => {
    // Distinct from the zero state: the inbox is not empty, the selection is
    // narrow. Rendering `inbox.zero` here would tell the user their inbox is
    // empty while it holds hundreds of rows they merely excluded.
    expect(main).toMatch(/t\("inbox\.filterEmpty"\)/);
    expect(main).toMatch(/t\("inbox\.zero"\)/);
    expect(main).toMatch(/mainEmptyReason === "filtered"/);
  });

  it("offers the clear action from that state, not just the sentence", () => {
    // A "no notifications match your filters" screen with no way to unset them
    // is a dead end: the user has to reopen the sheet and unpick up to four
    // dimensions to get their inbox back. Web pairs the two
    // (`inbox-page.tsx:602-617`, `filters.empty` + `filters.clear`).
    const filteredBranch = main.slice(
      main.indexOf('mainEmptyReason === "filtered"'),
      main.indexOf(") : (", main.indexOf('mainEmptyReason === "filtered"')),
    );
    expect(filteredBranch).toMatch(/clearFilters\(wsId\)/);
  });

  it("keeps the archive entry reachable from both empty states", () => {
    // Web's empty branch renders the footer (which carries this entry)
    // regardless of which label won (`inbox-list.tsx:201-217`), so a user whose
    // filter matches nothing can still reach what they filed away.
    const emptyBranch = main.slice(
      main.indexOf('mainEmptyReason !== "none"'),
      main.indexOf("<FlatList"),
    );
    expect(emptyBranch).toMatch(/\{archivedEntry\}/);
  });

  it("leaves the batch-actions menu main-view only", () => {
    // Standing rule, not this iteration's change: every batch entry archives
    // from the main inbox, so offering them over the archived list would read
    // as "archive all of these" and do the opposite.
    const archivedBranch = screen.slice(
      screen.indexOf('if (view === "archived")'),
      screen.indexOf('if (view === "archived")') + 3000,
    );
    expect(archivedBranch).not.toMatch(/onPress=\{onPressMenu\}/);
    expect(main).toMatch(/onPress=\{onPressMenu\}/);
  });

  it("keeps the archive's facet request off the main view", () => {
    // Both views now open the same sheet, so `filtersOpen` alone no longer
    // says which list the counts are for. Without the view gate, opening the
    // filter on the main inbox spends a request on the ARCHIVE's facets and
    // then discards the answer — the main view counts locally
    // (`inboxLocalFacets`). It also re-introduces the 404 the earlier paging
    // round was careful to keep off servers that lack the endpoint.
    expect(screen).toMatch(
      /enabled: !!wsId && filtersOpen && view === "archived",/,
    );
  });
});

describe("shared filter sheet", () => {
  const sheet = code(SHEET);

  it("takes its heading from the caller rather than naming one view", () => {
    expect(sheet).toMatch(/title: string;/);
    expect(sheet).toMatch(/title=\{title\}/);
    expect(sheet).not.toMatch(/title=\{t\("inbox\.archivedFilters"\)\}/);
  });

  it("makes the server-facet error state optional", () => {
    // The main view's counts are computed from the list in hand, so there is
    // no request to fail and no retry to offer; a mandatory prop would force
    // the screen to pass a no-op retry and render a dead button.
    expect(sheet).toMatch(/facetsError\?: boolean;/);
    expect(sheet).toMatch(/onRetryFacets\?: \(\) => void;/);
    expect(sheet).toMatch(/facetsError && onRetryFacets \?/);
  });

  it("still gates the priority section on the capability probe", () => {
    expect(sheet).toMatch(/showsPriorityFilter\(prioritySupport\)/);
  });
});
