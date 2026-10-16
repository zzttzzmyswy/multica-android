#!/usr/bin/env python3
"""Mutation-test iteration 252's "the projects list rows get web's kebab"
change (MYS-2197).

The defect was an *absence*: `projects` was the last of the nine list surfaces
with no row menu, so a row's only exit was `router.push` to the detail page and
neither pin nor delete was reachable from the list. An absence is the shape that
mutates most deceptively, because several plausible edits make the kebab appear
while leaving the feature wrong in a way the eye cannot catch:

  - a kebab on the CARD list only, while the table is the default view mode
    (most users never see it, and the table is what a cold open renders);
  - a delete entry shown to a plain member, which the server then rejects —
    web gates it on `isWorkspaceAdmin` and so does the batch bar;
  - a kebab whose delete does not ask first, or asks a *different* question
    than the detail page's (the sentence is what says the issues survive);
  - a kebab that writes through a second mutation instead of the toolbar's, so
    the two entry points disagree about the optimistic restore;
  - the pin direction read off `pinnedProjectIds` with no settlement gate, so
    an unresolved pin read claims 「置顶」 over an already-pinned project.

Each mutation injects exactly ONE such half-defect and asserts the suite turns
RED; the restore is then asserted GREEN. A guard that cannot be made to fail is
not a guard (the repo's standing discipline, `scripts/falsify-*.py`).

Run: python3 scripts/falsify-iter252-project-row-menu.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
SCREEN = APP / "components" / "project" / "projects-screen.tsx"
CARD_ROW = APP / "components" / "project" / "project-row.tsx"
TABLE_ROW = APP / "components" / "project" / "project-table-view.tsx"
ROW_MENU = APP / "components" / "project" / "project-row-menu.tsx"
ACTIONS = APP / "lib" / "project-row-actions.ts"

SUITE = [
    "lib/project-row-actions.test.ts",
    "lib/project-row-actions-wiring.test.ts",
]


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        ["npx", "--no-install", "vitest", "run", *SUITE],
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
        "1. the kebab reaches the card list only (table is the default view)",
        SCREEN,
        "          rowMenu={rowMenu}\n",
        "",
    ),
    (
        "2. the card kebab is dropped too — the row menu never reaches a row",
        SCREEN,
        "              menu={rowMenu}\n",
        "",
    ),
    (
        "3. delete is offered to a plain member (web gates on isWorkspaceAdmin)",
        SCREEN,
        "      canDelete: isWorkspaceAdmin,",
        "      canDelete: true,",
    ),
    (
        "4. the pin direction is read off the set with no settlement gate",
        SCREEN,
        "      pinsResolved: pinsRead.isResolved,",
        "      pinsResolved: true,",
    ),
    (
        "5. the pin list is defaulted to [] again (the pre-fix read shape)",
        SCREEN,
        """  const pinsRead = catalogRead(
    useQuery({
      ...pinListOptions(wsId, currentUserId),
      enabled: !!wsId && !!currentUserId,
    }),
  );
  const pins = pinsRead.items;""",
        """  const { data: pins = [] } = useQuery({
    ...pinListOptions(wsId, currentUserId),
    enabled: !!wsId && !!currentUserId,
  });
  const pinsRead = { isResolved: true, items: pins };""",
    ),
    (
        "6. the row delete writes through a second mutation, not the toolbar's",
        SCREEN,
        "              batchDelete.mutate([project.id], {",
        "              deleteProject.mutate(project.id, {",
    ),
    (
        "7. the row delete stops asking first (destructive write with no confirm)",
        SCREEN,
        """      Alert.alert(
        t("project.deleteTitle"),
        t("project.deleteMessage"),
        [""",
        """      if (true) return batchDelete.mutate([project.id]);
      Alert.alert(
        t("project.deleteTitle"),
        t("project.deleteMessage"),
        [""",
    ),
    (
        "8. an unsettled pin list falls back to offering 'pin' (the other sign "
        "of the same guess)",
        ACTIONS,
        "  if (row.pinsResolved) actions.push(row.pinned ? \"unpin\" : \"pin\");",
        "  actions.push(row.pinned ? \"unpin\" : \"pin\");",
    ),
    (
        "9. canDelete gates the pin entry instead of delete (web's shape swapped)",
        ACTIONS,
        """  if (row.pinsResolved) actions.push(row.pinned ? "unpin" : "pin");
  if (options.canDelete) actions.push("delete");""",
        """  if (row.pinsResolved && options.canDelete)
    actions.push(row.pinned ? "unpin" : "pin");
  actions.push("delete");""",
    ),
    (
        "10. delete is moved ahead of pin, losing web's destructive-last order",
        ACTIONS,
        """  if (row.pinsResolved) actions.push(row.pinned ? "unpin" : "pin");
  if (options.canDelete) actions.push("delete");""",
        """  if (options.canDelete) actions.push("delete");
  if (row.pinsResolved) actions.push(row.pinned ? "unpin" : "pin");""",
    ),
    (
        "11. the empty-return guard is dropped — a sheet with only Cancel opens",
        ROW_MENU,
        "  if (actions.length === 0) return null;\n",
        "",
    ),
    (
        "12. the menu writes to the server itself instead of calling back",
        ROW_MENU,
        "        else onTogglePin(project, action === \"unpin\");",
        "        else mutate({ item_type: \"project\", item_id: project.id });",
    ),
    (
        "13. the destructive entry loses its red marking (last under the thumb)",
        ROW_MENU,
        "        ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),",
        "",
    ),
    (
        "14. the card kebab survives selection mode, beside the checkbox",
        CARD_ROW,
        "{menu && !selectionMode ? <ProjectRowMenu project={project} {...menu} /> : null}",
        "{menu ? <ProjectRowMenu project={project} {...menu} /> : null}",
    ),
    (
        "15. the table kebab is moved into the scrolling body pane (off-screen "
        "at rest)",
        TABLE_ROW,
        """          ) : rowMenu ? (
            /* The row's "⋯" (MYS-2197). In selection mode it gives way to the
               checkbox — one control per row, and picking is what the mode is
               for (the rule the card list and the other eight row menus
               follow). */
            <ProjectRowMenu project={item} {...rowMenu} />
          ) : null}
        </Pressable>
      );
    }
    return (""",
        """          ) : null}
        </Pressable>
      );
    }
    return (""",
    ),
    (
        "16. the table's pinned pane is narrowed back, cutting the kebab off",
        TABLE_ROW,
        "const PINNED_WIDTH = 196;",
        "const PINNED_WIDTH = 148;",
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
