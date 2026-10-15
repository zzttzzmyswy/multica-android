#!/usr/bin/env python3
"""Mutation-test iteration 246's main-inbox filter layer (MYS-2174).

The bug being fixed is a WIRING bug: the filter store, the predicate, the
counts, the capability probe and the sheet all existed and were individually
correct — the main list simply never called any of them. A wiring fix is the
easiest kind to get half-right and still look right, because the visible half
(a filter button) works while the invisible half (a list that narrows, counts
that agree with it) silently does not. Each mutation below injects ONE such
half-defect and asserts the suite turns RED; the restore is asserted GREEN. A
guard that cannot be made to fail is not a guard — the repo's standing
discipline (`scripts/falsify-iter*.py`).

The five the acceptance criteria name:

   1. the main list does not pass through `filterInboxItems`
      -> a filter button that changes a badge and nothing else
   2. a dimension's count is computed WITH its own selection applied
      -> "0 unread" printed the instant the user ticks "unread only"
   3. the priority capability probe is bypassed (hardcoded "supported")
      -> a priority section offered against a backend that never honoured it
   4b. facet counting clears the wrong dimension
      -> counts that answer a different question than the row they sit beside
   6. the filtered-empty state collapses into the zero state
      -> "your inbox is empty" shown over an inbox holding 339 groups

The rest are the invariants the fix's correctness rests on:

   2a. the unread count forgets its second step (prints the visible total)
   3b. the probe reads the deduplicated list instead of the raw response
   3c. the capability probe's answer stops reaching the sheet
   3d. the priority-stripping copy is bypassed for the request
   4.  every count is taken over the UNFILTERED list (no faceting at all)
   4c. the actor universe is built from the faceted subset (self-deleting rows)
   5.  an empty read is bucketed as "unknown actor" instead of dropped
   7.  the sheet is mounted only in the archived branch
   8.  the sheet loses its caller-supplied heading
   9.  the archive's server facets are passed to the main view
  10.  the main view's trigger disappears
  11.  the main view badges the RAW filter count instead of the effective one
  12.  the sheet is shown the raw selection instead of the effective one
  13.  the clear action is dropped from the filtered-empty state
  14.  the archive entry disappears from the empty states
  15.  the archive's facet request starts firing for the main view too
  16.  an en value replaced by the zh string

Run: python3 scripts/falsify-iter246-main-inbox-filters.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
SCREEN = APP / "app" / "(app)" / "[workspace]" / "(tabs)" / "inbox.tsx"
LIB = APP / "lib" / "inbox-main-view.ts"
SHEET = APP / "components" / "inbox" / "inbox-archive-filter-sheet.tsx"
EN = APP / "lib" / "i18n" / "locales" / "en.json"

SUITE = [
    "lib/inbox-main-view.test.ts",
    "lib/inbox-main-filter-wiring.test.ts",
    "lib/i18n/iter246-keys.test.ts",
    "lib/i18n/locale-completeness.test.ts",
]


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        ["npx", "--no-install", "vitest", "run", *SUITE, "--hookTimeout=120000"],
        cwd=APP, capture_output=True, text=True, timeout=900,
    )
    out = proc.stdout + proc.stderr
    green = proc.returncode == 0
    tail = "\n".join(
        line for line in out.splitlines()
        if re.search(r"Tests\s+\d|Test Files\s+\d|error TS", line)
    )
    return green, tail


MUTATIONS: list[tuple[str, Path, str, str]] = [
    (
        "1. the main list stops passing through filterInboxItems",
        SCREEN,
        "  const visibleData = useMemo(\n"
        "    () => filterInboxItems(data, mainFilters),\n"
        "    [data, mainFilters],\n"
        "  );",
        "  const visibleData = useMemo(() => data, [data]);",
    ),
    (
        "1b. the list renders the unfiltered rows while the badge counts",
        SCREEN,
        "          data={visibleData}",
        "          data={data}",
    ),
    (
        "2a. the unread count stops filtering for unread rows (prints the total)",
        LIB,
        '    unreadCount: own("unreadOnly", false).filter((item) => item.read !== true)\n'
        "      .length,",
        '    unreadCount: own("unreadOnly", false).length,',
    ),
    (
        "2b. the status count applies its own selection",
        LIB,
        '    statuses: countsOf(own("statuses", []), (item) => item.issue_status ?? null),',
        '    statuses: countsOf(own("actors", []), (item) => item.issue_status ?? null),',
    ),
    (
        "3a. the capability probe is hardcoded to supported",
        SCREEN,
        "  const mainPrioritySupport = inboxPriorityFilterSupport(rawMainItems);",
        '  const mainPrioritySupport = "supported" as const;',
    ),
    (
        "3b. the probe reads the deduplicated list instead of the raw response",
        SCREEN,
        "  const mainPrioritySupport = inboxPriorityFilterSupport(rawMainItems);",
        "  const mainPrioritySupport = inboxPriorityFilterSupport(data);",
    ),
    (
        "3c. the probe's answer stops reaching the sheet",
        SCREEN,
        "        prioritySupport={mainPrioritySupport}\n"
        "        activeCount={mainActiveFilterCount}",
        '        prioritySupport={"supported"}\n'
        "        activeCount={mainActiveFilterCount}",
    ),
    (
        "3d. the priority-stripping copy is bypassed for the request",
        SCREEN,
        "    () => inboxFiltersForPrioritySupport(filters, mainPrioritySupport),",
        "    () => filters,",
    ),
    (
        "4a. every count is taken over the unfiltered list",
        LIB,
        "  const own = <K extends keyof InboxFilters>(dimension: K, cleared: InboxFilters[K]) =>\n"
        "    filterInboxItems([...items], { ...filters, [dimension]: cleared });",
        "  const own = <K extends keyof InboxFilters>(dimension: K, cleared: InboxFilters[K]) =>\n"
        "    filterInboxItems([...items], EMPTY_INBOX_FILTERS);",
    ),
    (
        "4b. facet counting clears the wrong dimension (status clears priority)",
        LIB,
        '    priorities: countsOf(\n'
        '      own("priorities", []),\n'
        "      (item) => item.issue_priority ?? null,\n"
        "    ),",
        '    priorities: countsOf(\n'
        '      own("statuses", []),\n'
        "      (item) => item.issue_priority ?? null,\n"
        "    ),",
    ),
    (
        "4c. the actor universe is built from the faceted subset",
        LIB,
        "  for (const item of items) {\n"
        "    const key = inboxActorKey(item);\n"
        "    if (key != null) actors[key] = 0;\n"
        "  }\n",
        "  for (const item of own(\"actors\", [])) {\n"
        "    const key = inboxActorKey(item);\n"
        "    if (key != null) actors[key] = 0;\n"
        "  }\n",
    ),
    (
        "5. an unattributable row is bucketed instead of dropped",
        LIB,
        '    if (key == null) continue;\n'
        "    counts[key] = (counts[key] ?? 0) + 1;",
        '    counts[key ?? "unknown"] = (counts[key ?? "unknown"] ?? 0) + 1;',
    ),
    (
        "6a. the filtered-empty state collapses into the zero state",
        LIB,
        '  return input.activeFilterCount > 0 ? "filtered" : "zero";',
        '  return "zero";',
    ),
    (
        "6b. the screen renders the zero-state copy for a filtered-empty list",
        SCREEN,
        '        {mainEmptyReason === "filtered" ? (',
        "        {false ? (",
    ),
    (
        "7. the sheet is mounted only in the archived branch",
        SCREEN,
        "        title={t(\"inbox.filters\")}\n"
        "        wsId={wsId}\n"
        "        filters={mainFilters}\n"
        "        facets={mainFacets}\n"
        "        facetsLoading={false}\n"
        "        prioritySupport={mainPrioritySupport}\n"
        "        activeCount={mainActiveFilterCount}\n"
        "        onToggleStatus={(status) => wsId && toggleStatusFilter(wsId, status)}\n"
        "        onTogglePriority={(priority) =>\n"
        "          wsId && togglePriorityFilter(wsId, priority)\n"
        "        }\n"
        "        onToggleActor={(actor) => wsId && toggleActorFilter(wsId, actor)}\n"
        "        onToggleUnreadOnly={() => wsId && toggleUnreadOnly(wsId)}\n"
        "        onClear={() => wsId && clearFilters(wsId)}\n"
        "      />\n",
        "",
    ),
    (
        "8. the sheet names one view instead of taking its heading from the caller",
        SHEET,
        "      title={title}",
        '      title={t("inbox.archivedFilters")}',
    ),
    (
        "9. the archive's server facets are handed to the main view",
        SCREEN,
        "        facets={mainFacets}\n"
        "        facetsLoading={false}",
        "        facets={facets}\n"
        "        facetsLoading={facetsLoading}",
    ),
    (
        "10. the main view's filter trigger disappears",
        SCREEN,
        "            <Pressable\n"
        "              onPress={() => setFiltersOpen(true)}\n"
        "              hitSlop={8}\n"
        "              accessibilityRole=\"button\"\n"
        "              accessibilityLabel={\n"
        "                mainActiveFilterCount > 0\n",
        "            <Pressable\n"
        "              onPress={() => {}}\n"
        "              hitSlop={8}\n"
        "              accessibilityRole=\"button\"\n"
        "              accessibilityLabel={\n"
        "                mainActiveFilterCount > 0\n",
    ),
    (
        "11. the main view badges the raw count instead of the effective one",
        SCREEN,
        "  const mainActiveFilterCount = inboxFilterCount(mainFilters);",
        "  const mainActiveFilterCount = inboxFilterCount(filters);",
    ),
    (
        "12. the sheet is shown the raw selection instead of the effective one",
        SCREEN,
        "        filters={mainFilters}\n"
        "        facets={mainFacets}",
        "        filters={filters}\n"
        "        facets={mainFacets}",
    ),
    (
        "13. the filtered-empty state loses its way out",
        SCREEN,
        '              <Button variant="outline" onPress={() => wsId && clearFilters(wsId)}>\n'
        '                <Text>{t("inbox.archivedFiltersClear")}</Text>\n'
        "              </Button>",
        "",
    ),
    (
        "14. the archive entry disappears from the empty states",
        SCREEN,
        "          {archivedEntry}\n"
        "        </View>\n"
        "      ) : (\n"
        "        <FlatList",
        "        </View>\n"
        "      ) : (\n"
        "        <FlatList",
    ),
    (
        "15. the archive's facet request starts firing for the main view too",
        SCREEN,
        "    enabled: !!wsId && filtersOpen && view === \"archived\",",
        "    enabled: !!wsId && filtersOpen,",
    ),
    (
        "16. an en value is replaced by the zh string",
        EN,
        '  "inbox.filters": "Filter inbox",',
        '  "inbox.filters": "筛选收件箱",',
    ),
]


def main() -> int:
    green, tail = run_suite()
    print("baseline:", "GREEN" if green else "RED")
    print(tail)
    if not green:
        print("!! baseline is already red — fix before mutating")
        return 1

    failures: list[str] = []
    for name, path, old, new in MUTATIONS:
        original = path.read_text()
        if old not in original:
            print(f"[SKIP] {name}: anchor not found in {path.name}")
            failures.append(name)
            continue
        path.write_text(original.replace(old, new, 1))
        try:
            mutated_green, _ = run_suite()
        finally:
            path.write_text(original)
        if mutated_green:
            print(f"[MISS] {name}: suite stayed GREEN")
            failures.append(name)
        else:
            print(f"[OK]   {name}: turned RED")
        # The restore must itself be green, or the mutation's verdict is junk.
        restored_green, _ = run_suite()
        if not restored_green:
            print(f"[BAD]  {name}: restore did not return to GREEN")
            failures.append(name)

    print()
    if failures:
        print(f"{len(failures)}/{len(MUTATIONS)} did not hold:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"all {len(MUTATIONS)} mutations turned RED and restored GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
