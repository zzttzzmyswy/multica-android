#!/usr/bin/env python3
"""Mutation-test iteration 261's four fixes (MYS-2255).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, scripts/falsify-*.py).

The four gaps this round closes, and what the mutations attack:

  #1  The stage picker's store had a tested `reset()` that production code
      never called, so a stage picked under parent A was already on the chip —
      and in the create payload — the next time "+" was tapped under the SAME
      parent. (The store's parent tag only covered the CROSS-parent case.)
      Mutations: drop the lifetime hook, define it without a cleanup, define it
      with an EMPTY cleanup (mounts, resets nothing), and re-open the
      cross-parent leak it must not regress.

  #2  A list row could not name its issue's project, so the workspace list gave
      no way to tell which project a task belonged to. Mutations: drop each of
      the three surfaces' project prop, drop the catalog read, and let the chip
      draw while the catalog is unresolved (which would print a project name
      the read might later retract).

  #3  A saved view carried none of the canvas-shape dimensions, so a mobile
      open-and-re-save silently flattened a web view's swimlane dimension,
      column set/order and table grouping — for every client. Mutations: drop
      each of the three from the write payload, drop each from the read/apply
      path, write mobile's bare column array instead of web's `{key,width?}`,
      and stop comparing them for the "modified" dot (which makes a change
      unsavable rather than lossy).

  #4  The squad roster could not give a member a role at add time, offered
      archived agents for promotion, and wrote `role: ""` instead of omitting
      it. Mutations: drop the role from the write, send "" instead of omitting,
      drop the archived gate on make-leader, and add one to remove (which would
      strand an archived row in the roster).

Run: python3 scripts/falsify-iter261-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

# This script lives in `apps/mobile/scripts/`, so the app root is one level up.
APP = Path(__file__).resolve().parent.parent

W = "app/(app)/[workspace]"
NEW_ISSUE = APP / W / "new-issue.tsx"
STAGE_STORE = APP / "data" / "stores" / "new-issue-stage-pick-store.ts"
ROW = APP / "components" / "issue" / "issue-row.tsx"
CHROME = APP / "components" / "issue" / "issue-surface-chrome.tsx"
ISSUES = APP / W / "more" / "issues.tsx"
MY_ISSUES = APP / W / "(tabs)" / "my-issues.tsx"
PROJECT_SURFACE = APP / "components" / "project" / "project-issue-surface.tsx"
VIEW_BAR = APP / "components" / "issue" / "issue-view-bar.tsx"
CODEC = APP / "data" / "stores" / "issue-view-codec.ts"
APPLY = APP / "lib" / "saved-view-apply.ts"
SQUAD_DETAIL = APP / W / "more" / "squads" / "[id].tsx"
SQUAD_PICKER = APP / "components" / "squad" / "squad-member-picker.tsx"
SQUAD_GUARDS = APP / "lib" / "squad-guards.ts"

SUITE = [
    "lib/iter261-wiring.test.ts",
    "lib/issue-row-project.test.ts",
    "lib/squad-guards.test.ts",
    "data/stores/issue-view-codec.test.ts",
    "data/stores/new-issue-stage-pick-store.test.ts",
]


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        [str(APP.parent.parent / "node_modules" / ".bin" / "vitest"), "run", *SUITE],
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
    # ── #1 the picked stage dies with the form ──────────────────────────────
    (
        "1. the create form never scopes the pick to its own lifetime, so the "
        "previous form's stage is already on the chip (the shipped bug)",
        NEW_ISSUE,
        "  useNewIssueStagePick();",
        "",
    ),
    (
        "2. the scoping hook mounts without a cleanup — identical at the call "
        "site, resets nothing",
        STAGE_STORE,
        "  useEffect(() => () => useNewIssueStagePickStore.getState().reset(), []);",
        "  useEffect(() => {}, []);",
    ),
    (
        "3. the hook resets on MOUNT instead of unmount, which looks harmless "
        "and leaves the spent value in place for the next form",
        STAGE_STORE,
        "  useEffect(() => () => useNewIssueStagePickStore.getState().reset(), []);",
        "  useEffect(() => { useNewIssueStagePickStore.getState().reset(); }, []);",
    ),
    (
        "4. the reset is implemented by dropping the parent tag, re-opening "
        "260's cross-parent leak",
        STAGE_STORE,
        "      return picked && picked.parentId === parentId ? picked.stage : null;",
        "      return picked ? picked.stage : null;",
    ),
    (
        "5. the stage rides the payload even with no parent — a write nothing "
        "can display",
        NEW_ISSUE,
        "...(parent && stage != null ? { stage } : {}),",
        "...(stage != null ? { stage } : {}),",
    ),

    # ── #2 a list row names its issue's project ─────────────────────────────
    (
        "6. the row never renders the project chip it resolved",
        ROW,
        "{projectChip ? (",
        "{false ? (",
    ),
    (
        "7. the row keeps the chip while the project catalog has not answered, "
        "printing a name the read may have to retract",
        APP / "lib" / "issue-row-project.ts",
        "  if (!project) return null;",
        "  if (!project) return { title: \"…\", icon: null };",
    ),
    (
        "8. the workspace Issues surface stops resolving the row's project",
        ISSUES,
        "project={findRowProject(projects, item.project_id)}",
        "project={null}",
    ),
    (
        "9. My Issues stops resolving the row's project",
        MY_ISSUES,
        "project={findRowProject(projects, item.project_id)}",
        "project={null}",
    ),
    (
        "10. the project issue surface stops resolving the row's project",
        PROJECT_SURFACE,
        "project={findRowProject(projects, item.project_id)}",
        "project={null}",
    ),
    (
        "11. the shared selection row drops the project prop on the floor",
        CHROME,
        "      project={project}\n",
        "",
    ),
    (
        "12. a surface keeps reading the catalog but never feeds it to the row",
        ISSUES,
        "  const { data: projects = [] } = useQuery(projectListOptions(wsId));",
        "  const projects: never[] = [];",
    ),

    # ── #3 a saved view carries the canvas-shape dimensions ─────────────────
    (
        "13. the save payload stops writing the swimlane dimension",
        VIEW_BAR,
        "          swimlaneGrouping: slice.swimlaneGrouping,\n",
        "",
    ),
    (
        "14. the save payload stops writing the column set",
        VIEW_BAR,
        "          tableColumns: slice.tableColumns,\n          tableColumnWidths: slice.tableColumnWidths,\n",
        "",
    ),
    (
        "15. the save payload stops writing the table grouping",
        VIEW_BAR,
        "          tableGrouping: slice.tableGrouping,\n",
        "",
    ),
    (
        "16. applying a view no longer restores the swimlane dimension (the "
        "filter alone is applied — the 'half applied view' symptom)",
        APPLY,
        "    swimlaneGrouping: display.swimlaneGrouping,\n",
        "",
    ),
    (
        "17. applying a view no longer restores the column set",
        APPLY,
        "    tableColumns: display.tableColumns,\n    tableColumnWidths: display.tableColumnWidths,\n",
        "",
    ),
    (
        "18. applying a view no longer restores the table grouping",
        APPLY,
        "    tableGrouping: display.tableGrouping,\n",
        "",
    ),
    (
        "19. the codec writes mobile's bare column array, dropping every width "
        "a web user pinned",
        CODEC,
        "      return width == null ? { key } : { key, width };",
        "      return { key };",
    ),
    (
        "20. the modified dot stops comparing the canvas dimensions, so a "
        "change to them lights no dot and has no save route",
        CODEC,
        "    sameCanvasShape(wantDisplay, slice, view.display)",
        "    true",
    ),
    (
        "21. a view that never fixed these dimensions reads as permanently "
        "modified (every pre-0.6.96 view would open with the dot lit)",
        CODEC,
        "    raw.swimlaneGrouping !== undefined &&",
        "    true &&",
    ),
    (
        "22. the column reader drops the TITLE column's width, so one mobile "
        "re-save resets a web user's pinned title width to the default",
        CODEC,
        "        widths.title = clampColumnWidth(width);",
        "",
    ),
    (
        "23. a title-only column set re-expands to the full default set, "
        "showing the user columns they had hidden",
        CODEC,
        '      tableColumns: pinnedTitle ? (["title"] as TableColumnKey[]) : defaults,',
        "      tableColumns: defaults,",
    ),
    (
        "24. the column reader accepts keys the table cannot render, so an "
        "unknown column paints an empty cell forever",
        CODEC,
        "    if (typeof rawKey !== \"string\" || !isRenderableTableColumn(rawKey)) continue;",
        "    if (typeof rawKey !== \"string\") continue;",
    ),

    # ── #4 squad roster: role on add, archived agents cannot lead ───────────
    (
        "25. the add-member write drops the role the user typed",
        SQUAD_DETAIL,
        "          ...squadMemberRoleField(role),",
        "",
    ),
    (
        "26. a blank role is written as \"\" instead of being omitted",
        SQUAD_GUARDS,
        "  return trimmed.length > 0 ? { role: trimmed } : {};",
        "  return { role: trimmed };",
    ),
    (
        "27. the guard ignores the server's archived status, so an archived "
        "member — absent from the archived-FREE agent directory — still offers "
        "'make leader' (the bug on-device verification caught)",
        SQUAD_GUARDS,
        '  const archived = targetArchived === true || targetStatus === "archived";',
        "  const archived = targetArchived === true;",
    ),
    (
        "28. the screen stops feeding the server's status into the guard, so "
        "the roster's 「已归档」 pill and the action menu disagree",
        SQUAD_DETAIL,
        "        targetStatus: statusById.get(member.member_id)?.status,",
        "        targetStatus: null,",
    ),
    (
        "29. an archived agent can be promoted to leader, heading the squad "
        "with something that cannot run",
        SQUAD_GUARDS,
        "    canSetLeader: target.member_type === \"agent\" && !isLeader && !archived,",
        "    canSetLeader: target.member_type === \"agent\" && !isLeader,",
    ),
    (
        "30. remove is hidden for an archived member too, stranding the row in "
        "the roster with no way out",
        SQUAD_GUARDS,
        "    canRemove: !isLeader && !isSelf,",
        "    canRemove: !isLeader && !isSelf && !targetArchived,",
    ),
    (
        "31. the member action sheet stops passing the archived flag, so the "
        "guard can never fire",
        SQUAD_DETAIL,
        "        targetArchived:",
        "        targetArchivedIgnored:",
    ),
    (
        "32. the picker offers archived agents again",
        SQUAD_GUARDS,
        "      (a) => !a.archived_at && !current.has(`agent:${a.id}`),",
        "      (a) => !current.has(`agent:${a.id}`),",
    ),
    (
        "33. add mode confirms on the first tap, so a member can never be "
        "given a role from a phone",
        SQUAD_PICKER,
        "    setStaged({ target, name });",
        "    onPick(target, \"\");\n    close();",
    ),
    (
        "34. the role step is reachable but its value never reaches the write",
        SQUAD_PICKER,
        "                        onPick(staged.target, role);",
        "                        onPick(staged.target, \"\");",
    ),
]


def apply(path: Path, old: str, new: str) -> str:
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"PATTERN NOT FOUND in {path}:\n{old}")
    if text.count(old) != 1:
        raise SystemExit(f"PATTERN NOT UNIQUE ({text.count(old)}x) in {path}:\n{old}")
    path.write_text(text.replace(old, new, 1))
    return text


def main() -> int:
    green, tail = run_suite()
    if not green:
        print("BASELINE IS RED — fix that first")
        print(tail)
        return 1
    print(f"baseline GREEN ({len(MUTATIONS)} mutations queued)\n")

    failures: list[str] = []
    for i, (desc, path, old, new) in enumerate(MUTATIONS, 1):
        original = apply(path, old, new)
        try:
            now_green, tail = run_suite()
        finally:
            path.write_text(original)
        if now_green:
            print(f"  [{i:2d}] STAYED GREEN — {desc}")
            failures.append(desc)
        else:
            print(f"  [{i:2d}] red  ✓  {desc}")

    green, tail = run_suite()
    print()
    if not green:
        print("RESTORE FAILED — suite is red after the run")
        print(tail)
        return 1
    if failures:
        print(f"{len(failures)} mutation(s) STAYED GREEN:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"all {len(MUTATIONS)} mutations turned RED; suite restored GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
