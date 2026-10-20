#!/usr/bin/env python3
"""Mutation-test iteration 262's four fixes (MYS-2268).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, scripts/falsify-*.py).

The four gaps this round closes, and what the mutations attack:

  #1  The issue filter chip bar had no "clear all", so clearing six dimensions
      meant six taps. Web's `clearAll` has TWO branches — inside a view it
      returns to the view's own conditions, outside it clears — and both clear
      the date window, which is not in the filter snapshot at all. Mutations:
      implement only `clearFilters` (editing the open view), drop the date
      pair on each of the three surfaces, and stop rendering the control.

  #2  The table column picker had no search, so a workspace with twenty
      properties meant scrolling. Web runs one query against BOTH sections and
      lets each vanish independently. Mutations: search only the properties,
      compute the match but render the raw lists anyway, pin the system
      section open regardless of the query, and stop reporting the empty case.

  #3  Creating an issue always closed the form, so filing five tasks meant
      five trips through the parent/project pickers. Web's "create another" is
      a STANDING preference and its reset keeps the ASSIGNEE while clearing
      everything else. Mutations: clear the assignee too (the plausible-looking
      "reset everything"), reset only the store and not the mention editors,
      keep the module-level stage pick, keep the parent, and wire only the
      manual submit path.

  #4  An agent's skill rows were not pressable, so "what is in this skill?"
      meant leaving the agent page. Mutations: let a runtime skill's discovery
      key reach the workspace endpoint (404 rendered as "deleted"), collapse
      the failed-read state into empty content, and nest the Switch inside the
      label press target (which swallows its taps).

Run: python3 scripts/falsify-iter262-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"

W = "app/(app)/[workspace]"
CHROME = APP / "components" / "issue" / "issue-surface-chrome.tsx"
MY_ISSUES = APP / W / "(tabs)" / "my-issues.tsx"
ISSUES = APP / W / "more" / "issues.tsx"
PROJECT_SURFACE = APP / "components" / "project" / "project-issue-surface.tsx"
TABLE = APP / "components" / "issue" / "table-view.tsx"
NEW_ISSUE = APP / W / "new-issue.tsx"
DRAFT_STORE = APP / "data" / "stores" / "new-issue-draft-store.ts"
SKILL_SECTION = APP / "components" / "agent" / "agent-skills-section.tsx"
SKILL_SHEET = APP / "components" / "agent" / "agent-skill-detail-sheet.tsx"
SKILL_MODEL = APP / "lib" / "agent-skill-detail.ts"
KEEP_OPEN_LIB = APP / "lib" / "new-issue-keep-open.ts"

SUITE = [
    "lib/iter262-wiring.test.ts",
    "lib/table-column-search.test.ts",
    "lib/new-issue-keep-open.test.ts",
    "lib/agent-skill-detail.test.ts",
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
    # ── #1 clear all ────────────────────────────────────────────────────────
    (
        "1. clear-all implements only the no-view branch, so inside a saved "
        "view it wipes the view's own conditions instead of returning to them",
        CHROME,
        "    const state = store.getState();\n"
        "    if (baseline) {\n"
        "      // Back to exactly the view's own conditions — NOT to empty.\n"
        "      state.resetFiltersTo(baseline.raw);\n"
        "      return;\n"
        "    }\n"
        "    state.clearFilters();",
        "    const state = store.getState();\n"
        "    state.clearFilters();",
    ),
    (
        "2. the my-issues surface clears the dimensions but leaves the date "
        "window filtering the list behind an empty chip bar",
        MY_ISSUES,
        "          onClearAll={() => {\n"
        "            clearAllChips();\n"
        "            // The date window lives outside the filter snapshot, so the hook\n"
        "            // cannot clear it — web pairs every clearAll branch with this\n"
        "            // (`filter-chips-bar.tsx:709、:714`).\n"
        "            useMyIssuesViewStore.getState().setDateFilter(null);\n"
        "          }}",
        "          onClearAll={() => {\n"
        "            clearAllChips();\n"
        "          }}",
    ),
    (
        "3. the workspace issues surface drops the date clear from clear-all",
        ISSUES,
        "          onClearAll={() => {\n"
        "            clearAllChips();\n"
        "            useIssuesViewStore.getState().setDateFilter(null);\n"
        "          }}",
        "          onClearAll={() => {\n"
        "            clearAllChips();\n"
        "          }}",
    ),
    (
        "4. the project surface drops the date clear from clear-all",
        PROJECT_SURFACE,
        "          onClearAll={() => {\n"
        "            clearAllChips();\n"
        "            useProjectIssuesViewStore.getState().setDateFilter(null);\n"
        "          }}",
        "          onClearAll={() => {\n"
        "            clearAllChips();\n"
        "          }}",
    ),
    (
        "5. the clear-all control is never rendered, so the hook is dead code "
        "and the user still taps six chips",
        CHROME,
        "          onPress={onClearAll}",
        "          onPress={() => {}}",
    ),

    # ── #2 column picker search ─────────────────────────────────────────────
    (
        "6. the search filters only custom properties, leaving every system "
        "column pinned — typing '日期' would not find the date columns",
        APP / "lib" / "table-column-search.ts",
        "  const matchedColumns = columns.filter((column) =>\n"
        "    column.label.toLocaleLowerCase().includes(query),\n"
        "  );",
        "  const matchedColumns = [...columns];",
    ),
    (
        "7. the match is computed but the raw lists are rendered anyway, so "
        "the search box changes nothing on screen",
        TABLE,
        "                  {matched.columns.map((column) => (",
        "                  {TABLE_SYSTEM_COLUMNS.map((column) => (",
    ),
    (
        "8. the system section renders regardless of the query, so a query "
        "that matches nothing still shows every system column",
        TABLE,
        "              {matched.columns.length > 0 ? (",
        "              {true ? (",
    ),
    (
        "9. a query that matches nothing shows two absent sections with no "
        "explanation instead of the no-match note",
        TABLE,
        "              {matched.empty ? (",
        "              {false ? (",
    ),
    (
        "10. the search normalizes with toLowerCase instead of "
        "toLocaleLowerCase, diverging from web on locale-sensitive labels",
        APP / "lib" / "table-column-search.ts",
        "  return search.trim().toLocaleLowerCase();",
        "  return search.trim().toLowerCase();",
    ),
    (
        "11. a whitespace-only query is treated as a real query, blanking the "
        "picker when the keyboard leaves a stray space",
        APP / "lib" / "table-column-search.ts",
        '  const query = normalizeColumnQuery(search);\n  if (query === "") {',
        '  const query = search.toLocaleLowerCase();\n  if (query === "") {',
    ),

    # ── #3 create another ───────────────────────────────────────────────────
    (
        "12. the batch reset clears the assignee too — the obvious-looking "
        "'reset everything' that removes the feature's whole benefit",
        DRAFT_STORE,
        "      const { assignee } = get();\n"
        "      const next: NewIssueDraftValues = { ...EMPTY_NEW_ISSUE_DRAFT, assignee };",
        "      const next: NewIssueDraftValues = { ...EMPTY_NEW_ISSUE_DRAFT };",
    ),
    (
        "13. the batch reset leaves the mention editors untouched, so the "
        "next issue opens showing the previous body",
        NEW_ISSUE,
        '    description.setText("");\n    promptInput.setText("");',
        "",
    ),
    (
        "14. the batch reset leaves the module-level stage pick in place, "
        "re-opening the MYS-2255 defect through the new path",
        NEW_ISSUE,
        "    useNewIssueStagePickStore.getState().reset();",
        "",
    ),
    (
        "15. the batch reset keeps the parent, filing unrelated tasks under "
        "the previous issue's sub-task tree",
        NEW_ISSUE,
        "    setParentCleared(true);",
        "",
    ),
    (
        "16. only the manual submit path honours the preference, so agent-mode "
        "creates still close the form the user asked to keep open",
        NEW_ISSUE,
        "      finishCreate();\n      return true;\n    } catch (err) {\n"
        "      Alert.alert(\n        t(\"newIssue.failedTitle\"),",
        "      resetDraft();\n      router.back();\n      return true;\n    } catch (err) {\n"
        "      Alert.alert(\n        t(\"newIssue.failedTitle\"),",
    ),
    (
        "17. the close branch forgets to pop, leaving the form permanently "
        "open when the preference is off",
        NEW_ISSUE,
        "    resetDraft();\n    router.back();",
        "    resetDraft();",
    ),
    (
        "18. the preference is inverted, closing exactly when the user asked "
        "to keep creating",
        KEEP_OPEN_LIB,
        "  return keepOpen === true;",
        "  return keepOpen !== true;",
    ),
    (
        "18b. the kept-open branch resets but the close branch no longer does, "
        "so the next open restores the issue just filed",
        NEW_ISSUE,
        "    resetDraft();\n    router.back();",
        "    router.back();",
    ),

    # ── #4 agent skill detail ───────────────────────────────────────────────
    (
        "19. a runtime skill's discovery key is sent to the workspace "
        "endpoint, whose 404 then renders as 'this skill was deleted'",
        SKILL_SECTION,
        '    selected?.kind === "workspace" ? selected.id : "";',
        '    selected?.kind === "runtime" ? selected.skill.key : "";',
    ),
    (
        "20. the detail read runs for runtime selections too",
        SKILL_SECTION,
        '    enabled: !!wsId && selectedWorkspaceId !== "",',
        "    enabled: !!wsId,",
    ),
    (
        "21. a failed content read is collapsed into empty content, telling "
        "the user the skill is blank when it is only unread",
        SKILL_MODEL,
        '  if (workspaceRead.state === "failed") return { kind: "workspace-error" };',
        '  if (workspaceRead.state === "failed") return { kind: "workspace", content: "", files: [] };',
    ),
    (
        "22. a read still in flight is rendered as empty content instead of a "
        "loading state",
        SKILL_MODEL,
        '  if (workspaceRead.state === "loading") return { kind: "workspace-loading" };',
        '  if (workspaceRead.state === "loading") return { kind: "workspace", content: "", files: [] };',
    ),
    (
        "23. the workspace row stops opening anything, so the feature is "
        "reachable only for runtime skills",
        SKILL_SECTION,
        "                      setSelected(workspaceSkillSelection(skill))",
        "                      setSelected(null)",
    ),
    (
        "24. the runtime row stops opening anything",
        SKILL_SECTION,
        "                    onPress={() => setSelected(runtimeSkillSelection(skill))}",
        "                    onPress={() => setSelected(null)}",
    ),
    (
        "25. a workspace selection with no id still fetches, hitting "
        "/api/skills/undefined",
        SKILL_MODEL,
        "  if (!skill.id) return null;",
        "  if (false) return null;",
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
