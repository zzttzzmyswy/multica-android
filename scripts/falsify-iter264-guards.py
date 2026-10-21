#!/usr/bin/env python3
"""Mutation-test iteration 264's two fixes (MYS-2291).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, scripts/falsify-*.py).

The two gaps this round closes, and what the mutations attack:

  #1  The inbox gained web's "no agents working" dimension. Three things make
      it correct and each is independently easy to lose: it must read the
      running-OR-QUEUED projection rather than the running-only one; it must
      fail CLOSED while the agent-task snapshot is unresolved, instead of
      reading "unresolved" as "nobody is working"; and it must never reach the
      archive, whose server has no such dimension. Mutations: read the wrong
      projection, degrade an unresolved set to empty, drop the snapshot from
      the count, count with the flag cleared, let the selection into the
      archive's key, count it in the archive's badge, apply it to the archive's
      rows, and render the row in the archive's sheet.

  #2  Quick actions became authorable WITHOUT a target. The dangerous halves
      are all about the difference between "no target" and "broken target":
      the empty PAIR on the wire (an omitted field is a silent no-op on PATCH),
      a picker that can clear the selection, `canSave` that does not require
      one, and a settings row that reads `assignee_type === ""` BEFORE
      `target_missing` — the server reports a targetless action as FOUND, so
      the flag is false and the wrong order prints an empty name. Mutations:
      omit the pair, hard-require a target, put the cleared row inside the
      filtered list, read the state in the wrong order, and print "runs as" for
      a targetless action.

Run: python3 scripts/falsify-iter264-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"

W = "app/(app)/[workspace]"

INBOX_FILTERS = APP / "lib" / "inbox-filters.ts"
INBOX_MAIN_VIEW = APP / "lib" / "inbox-main-view.ts"
INBOX_SCREEN = APP / W / "(tabs)" / "inbox.tsx"
INBOX_SHEET = APP / "components" / "inbox" / "inbox-archive-filter-sheet.tsx"
SNAPSHOT = APP / "data" / "queries" / "agent-task-snapshot.ts"

QA_TARGET = APP / "lib" / "quick-action-target.ts"
QA_FORM = APP / "components" / "quick-action" / "quick-action-form.tsx"
QA_PICKER = APP / "components" / "quick-action" / "agent-squad-picker-modal.tsx"
QA_SETTINGS = APP / W / "more" / "settings" / "quick-actions.tsx"
QA_SECTION = APP / "components" / "quick-action" / "quick-actions-section.tsx"

SUITE = [
    "lib/inbox-filters.test.ts",
    "lib/inbox-main-view.test.ts",
    "lib/quick-action-target.test.ts",
    "lib/iter264-wiring.test.ts",
]


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        ["../../node_modules/.bin/vitest", "run", *SUITE],
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
    # ── #1 the inbox "no agents working" dimension ──────────────────────────
    (
        "1. the dimension reads the running-only projection, so an issue whose "
        "task was just dispatched is 'idle' on the phone and busy on the web",
        SNAPSHOT,
        "        : new Set(deriveIssueSurfaceActivity(data).activityByIssueId.keys()),",
        "        : deriveRunningIssueIds(data),",
    ),
    (
        "2. an unresolved snapshot degrades to an empty set, so the whole inbox "
        "shows for a frame under a filter promising nobody is working",
        INBOX_FILTERS,
        "      (item.issue_id != null &&\n"
        "        activeIssueIds != null &&\n"
        "        !activeIssueIds.has(item.issue_id)) ||",
        "      (item.issue_id != null &&\n"
        "        !(activeIssueIds ?? EMPTY_ISSUE_IDS).has(item.issue_id)) ||",
    ),
    (
        "3. a notification with no issue passes the idle predicate, filling a "
        "'no agents working' list with rows that are not about work at all",
        INBOX_FILTERS,
        "      (item.issue_id != null &&\n"
        "        activeIssueIds != null &&\n"
        "        !activeIssueIds.has(item.issue_id)) ||",
        "      (activeIssueIds != null &&\n"
        "        !activeIssueIds.has(item.issue_id ?? \"\")) ||",
    ),
    (
        "4. the idle count ignores the snapshot, so every row counts as idle "
        "and the number beside the row is the size of the whole inbox",
        INBOX_MAIN_VIEW,
        "  const idleCount =\n"
        "    activeIssueIds === undefined\n"
        "      ? undefined\n"
        "      : filterInboxItems([...items], { ...filters, idleOnly: true }, {\n"
        "          activeIssueIds,\n"
        "        }).length;",
        "  const idleCount = filterInboxItems([...items], {\n"
        "    ...filters,\n"
        "    idleOnly: true,\n"
        "  }).length;",
    ),
    (
        "5. the idle count clears its own flag instead of setting it, so it "
        "reports the visible total rather than what the dimension reveals",
        INBOX_MAIN_VIEW,
        "      : filterInboxItems([...items], { ...filters, idleOnly: true }, {\n"
        "          activeIssueIds,\n"
        "        }).length;",
        "      : filterInboxItems([...items], { ...filters, idleOnly: false }, {\n"
        "          activeIssueIds,\n"
        "        }).length;",
    ),
    (
        "6. the other four counts stop seeing the snapshot, so with the "
        "dimension ON every status and actor prints 0 beside a live row",
        INBOX_MAIN_VIEW,
        "    filterInboxItems([...items], { ...filters, [dimension]: cleared }, {\n"
        "      activeIssueIds,\n"
        "    });",
        "    filterInboxItems([...items], { ...filters, [dimension]: cleared });",
    ),
    (
        "7. the idle selection leaks into the archive's normalized key, so the "
        "same archive query is cached twice and a parameter the server does not "
        "know goes on the wire",
        INBOX_FILTERS,
        "    actors: [...filters.actors].sort(),\n"
        "    unreadOnly: filters.unreadOnly,\n"
        "  };\n"
        "}",
        "    actors: [...filters.actors].sort(),\n"
        "    unreadOnly: filters.unreadOnly,\n"
        "    idleOnly: \"idleOnly\" in filters ? filters.idleOnly : false,\n"
        "  } as ArchivedInboxFilters;\n"
        "}",
    ),
    (
        "8. the archive's badge counts the idle selection its list is not "
        "applying, so the trigger claims to narrow a list it is not",
        INBOX_SCREEN,
        "  const archivedActiveFilterCount = inboxFilterCount(archivedFilters);",
        "  const archivedActiveFilterCount = inboxFilterCount(filters);",
    ),
    (
        "9. the archive's rows are filtered against the raw store value, so an "
        "idle selection silently empties the archived list client-side while "
        "the server never heard about it",
        INBOX_SCREEN,
        "    () => filterInboxItems(rawArchivedItems, archivedFilters),",
        "    () => filterInboxItems(rawArchivedItems, filters, {\n"
        "      activeIssueIds,\n"
        "    }),",
    ),
    (
        "10. the sheet renders the idle row in BOTH views, so the archive grows "
        "a checkbox that filters nothing",
        INBOX_SHEET,
        "          {!archived && onToggleIdleOnly ? (",
        "          {onToggleIdleOnly ? (",
    ),
    (
        "11. the sheet decides by something other than the caller's flag — here "
        "inferring 'archived' from the facet error, which the main view never "
        "sets, so both views look active",
        INBOX_SHEET,
        "          {!archived && onToggleIdleOnly ? (",
        "          {!facetsError && onToggleIdleOnly ? (",
    ),
    (
        "12. the main view filters its list with the snapshot held back, so "
        "turning the dimension on empties the screen instead of narrowing it",
        INBOX_SCREEN,
        "  const visibleData = useMemo(\n"
        "    () => filterInboxItems(data, mainFilters, filterContext),",
        "  const visibleData = useMemo(\n"
        "    () => filterInboxItems(data, mainFilters),",
    ),
    (
        "13. an idle selection waiting on the snapshot draws its EMPTY state "
        "instead of the loading one, telling the user nothing matches",
        INBOX_SCREEN,
        "      {isLoading || idleFilterPending ? (",
        "      {isLoading ? (",
    ),
    (
        "14. the archive's Clear gate counts every dimension regardless of the "
        "view, so idle-only enables Clear on a list it never narrowed",
        INBOX_FILTERS,
        "  return filters.idleOnly ? { ...filters, idleOnly: false } : filters;",
        "  return filters;",
    ),

    # ── #2 quick actions without a target ──────────────────────────────────
    (
        "15. a cleared target is sent as an omitted field, which PATCH reads as "
        "'leave it alone' — save reports success and the old binding survives",
        QA_TARGET,
        '    : { assignee_type: "", assignee_id: "" };',
        '    : ({} as { assignee_type: QuickActionAssigneeType; assignee_id: string });',
    ),
    (
        "16. the cleared binding drops only the type, leaving a real id beside "
        "an empty type — the one half-binding the server rejects with a 400",
        QA_TARGET,
        '    : { assignee_type: "", assignee_id: "" };',
        '    : { assignee_type: "", assignee_id: "00000000-0000-0000-0000-000000000000" };',
    ),
    (
        "17. Save requires a target again, so 'post without mentioning anyone' "
        "cannot be authored on the phone at all",
        QA_TARGET,
        "    form.prompt.trim().length > 0 &&\n    form.templateToken === null",
        "    form.prompt.trim().length > 0 &&\n"
        "    form.templateToken === null &&\n"
        "    false",
    ),
    (
        "18. the form returns early on a missing target, so the button is "
        "enabled, the handler no-ops and nothing reports anything",
        QA_FORM,
        "    if (!canSave || saving) return;\n    setSaving(true);",
        "    if (!canSave || saving) return;\n    if (!assignee) return;\n    setSaving(true);",
    ),
    (
        "19. the picker cannot clear the selection — the call site is typed so "
        "that 'no target' is unrepresentable and onChange(null) never lands",
        QA_PICKER,
        "                    onChange(null);",
        "                    onChange(value as never);",
    ),
    (
        "20. the 'no target' row moves INSIDE the filtered list, so a search "
        "that matches nothing takes away the only way to clear the binding",
        QA_PICKER,
        "              ListHeaderComponent={",
        "              ListFooterComponent={",
    ),
    (
        "21. the settings row reads target_missing FIRST, so a targetless action "
        "(which the server reports as FOUND) falls through to printing an empty "
        "target name",
        QA_TARGET,
        '  if (action.assignee_type === "") return "none";\n'
        "  if (action.target_missing === true) return \"missing\";",
        "  if (action.target_missing === true) return \"missing\";",
    ),
    (
        "22. a deleted target is reported as 'made private', sending the owner "
        "to the wrong screen to fix it",
        QA_TARGET,
        '  if (action.target_missing === true) return "missing";',
        '  if (action.target_missing === true) return "mismatched";',
    ),
    (
        "23. a private action's private target is flagged as a mismatch, which "
        "is a promise private actions never made",
        QA_TARGET,
        '  if (action.visibility === "public" && action.target_public !== true) {',
        "  if (action.target_public !== true) {",
    ),
    (
        "24. the issue row prints 'runs as the agent' for a targetless action, "
        "naming a target that does not exist",
        QA_TARGET,
        '  return action.assignee_type !== "";',
        "  return true;",
    ),
    (
        "25. the settings row grows its own copy of the rule and reads the flag "
        "directly again, free to drift from the ordered one",
        QA_SETTINGS,
        '    case "none":',
        '    case "none-unreachable":',
    ),
    (
        "26. the form labels a cleared target as an unpicked one, so the author "
        "goes looking for the setting they just made",
        QA_FORM,
        '    if (!assignee) return t("quickActions.noTarget");',
        '    if (!assignee) return t("quickActions.selectTarget");',
    ),
]


def find(path: Path, needle: str) -> int:
    return path.read_text().count(needle)


_backups: dict[Path, str] = {}


def snapshot() -> None:
    for _, path, _, _ in MUTATIONS:
        _backups.setdefault(path, path.read_text())


def restore() -> None:
    for path, text in _backups.items():
        path.write_text(text)


def main() -> int:
    snapshot()

    print("=" * 78)
    print("baseline")
    green, tail = run_suite()
    print(("GREEN" if green else "RED") + "  " + tail.replace("\n", " | "))
    if not green:
        print("baseline is not green — refusing to run mutations")
        return 1

    failures: list[str] = []
    for index, (label, path, needle, replacement) in enumerate(MUTATIONS, start=1):
        occurrences = find(path, needle)
        if occurrences != 1:
            failures.append(
                f"[MISS] {label}: needle appears {occurrences}x in {path.name} "
                "(expected exactly 1 — the mutation no longer targets live code)"
            )
            print(f"[MISS] {index:>2}. {label}: needle x{occurrences}")
            continue
        restore()
        text = path.read_text()
        path.write_text(text.replace(needle, replacement, 1))
        green, tail = run_suite()
        restore()
        if green:
            failures.append(f"[BAD ] {label}: suite stayed GREEN — guard does not exist")
            print(f"[BAD ] {index:>2}. {label}: stayed GREEN")
        else:
            print(f"[OK]  {index:>2}. {label}: turned RED")

    print("=" * 78)
    restore()
    green, tail = run_suite()
    print("restore: " + ("GREEN" if green else "RED") + "  " + tail.replace("\n", " | "))
    if not green:
        failures.append("[BAD ] the suite did not return to GREEN after restore")

    if failures:
        print(f"\n{len(failures)} problem(s):")
        for line in failures:
            print("  " + line)
        return 1
    print(f"\nall {len(MUTATIONS)} mutations turned RED and restored GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
