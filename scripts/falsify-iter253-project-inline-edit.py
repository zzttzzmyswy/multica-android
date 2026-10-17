#!/usr/bin/env python3
"""Mutation-test iteration 253's "the projects list edits status / priority /
lead from the row" change (MYS-2202).

The defect was an *absence*: both of the projects list's views rendered those
three fields as static text, so changing any of them meant opening the project
first. Web makes all three in-place controls in both of its views
(`packages/views/projects/components/projects-page.tsx:406-460,613-680`).

An absence is the shape that mutates most deceptively, because several
plausible edits make a control *appear* while leaving the feature wrong in a way
the eye cannot catch:

  - the editor reaching the CARD list only, while the table is `viewMode`'s
    default (most users never see the card, and the table is what a cold open
    renders);
  - a cell rendered beside the row's tap target instead of inside it, so the
    row tap swallows the edit — or inside it in a way that steals navigation;
  - the write going through a second mutation instead of `useUpdateProject`, so
    the in-row edit and the detail page disagree about the optimistic restore
    and about which failure title the alert reads;
  - the lead cell falling back to an "unassigned" sentence while the member and
    agent directories are still loading — the read-side defect
    `lib/catalog-state.ts` closed for pickers (MYS-1892/1907), reappearing in
    the one place a value is read as a fact without tapping;
  - a lead this client cannot name collapsing into "no lead" instead of the
    id fragment `lib/actor-profile.ts` settled on;
  - the cells staying live in multi-select, swallowing the tap that picks a row;
  - the old static cells left in place beside the new ones.

Each mutation injects exactly ONE such half-defect and asserts the suite turns
RED; the restore is then asserted GREEN. A guard that cannot be made to fail is
not a guard (the repo's standing discipline, `scripts/falsify-*.py`).

Run: python3 scripts/falsify-iter253-project-inline-edit.py
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
CELLS = APP / "components" / "project" / "project-inline-cells.tsx"
EDITOR = APP / "components" / "project" / "project-cell-editor.tsx"
DECISIONS = APP / "lib" / "project-inline-edit.ts"
LOOKUP = APP / "data" / "use-actor-name.ts"

SUITE = [
    "lib/project-inline-edit.test.ts",
    "lib/project-inline-edit-wiring.test.ts",
    "lib/i18n/iter253-keys.test.ts",
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
    (
        "1. the editor reaches the table only (the card list never gets it)",
        SCREEN,
        "              menu={rowMenu}\n              inlineEdit={inlineEdit}\n",
        "              menu={rowMenu}\n",
    ),
    (
        "2. the editor reaches the card only (the table is the default view)",
        SCREEN,
        "          rowMenu={rowMenu}\n          inlineEdit={inlineEdit}\n",
        "          rowMenu={rowMenu}\n",
    ),
    (
        "3. the cells keep working in multi-select, swallowing the pick tap",
        DECISIONS,
        "  return !selectionMode && isEditableProjectColumn(column);",
        "  return isEditableProjectColumn(column);",
    ),
    (
        "4. the write goes through a second mutation, not the detail page's",
        EDITOR,
        "  const updateProject = useUpdateProject(projectId);",
        "  const updateProject = { mutate: (patch: UpdateProjectRequest) => api.updateProject(projectId, patch) };",
    ),
    (
        "5. a half-set lead pair is sent for the clear (lead_type kept)",
        DECISIONS,
        "    ? { lead_type: null, lead_id: null }",
        '    ? { lead_type: "member", lead_id: null }',
    ),
    (
        "6. the lead cell asserts 'no lead' from an unanswered directory read",
        DECISIONS,
        "    return catalogsResolved ? { kind: \"none\" } : { kind: \"pending\" };",
        "    return { kind: \"none\" };",
    ),
    (
        "7. an unresolvable lead collapses into 'no lead' (it may not exist)",
        DECISIONS,
        """  return catalogsResolved
    ? { kind: "name", name: leadId.slice(0, 8) }
    : { kind: "pending" };""",
        """  return catalogsResolved ? { kind: "none" } : { kind: "pending" };""",
    ),
    (
        "8. the pending state is rendered instead of staying silent",
        CELLS,
        '  if (cell.kind === "pending") return null;',
        '  if (cell.kind === "pending") return <Text>—</Text>;',
    ),
    (
        # Iteration 254 folded the inline conjunction into `resolvedBy` so an
        # agent-only surface need not wait for the member read; the lead cell's
        # two-directory rule is now this fold, and these two mutations attack
        # it at its new anchor (same defect, same assertion in the suite).
        "9. the resolution flag is taken from the member read alone",
        LOOKUP,
        "  const resolved = resolvedBy.member && resolvedBy.agent;",
        "  const resolved = resolvedBy.member;",
    ),
    (
        "10. the actor lookup reports 'resolved' unconditionally",
        LOOKUP,
        "  const resolved = resolvedBy.member && resolvedBy.agent;",
        "  const resolved = true;",
    ),
    (
        "11. the sheet stops hosting the detail routes' status body",
        EDITOR,
        """      {target.column === "status" ? (
        <ProjectStatusPickerBody
          value={target.project.status}
          onChange={(status) => commit({ status })}
        />
      ) : target.column === "priority" ? (""",
        """      {target.column === "status" ? (
        <ProjectPriorityPickerBody
          value={target.project.priority}
          onChange={(priority) => commit({ priority })}
        />
      ) : target.column === "priority" ? (""",
    ),
    (
        "12. the status column loses its in-place editor in the pinned pane",
        TABLE_ROW,
        "            <ProjectStatusCell\n              project={item}\n              edit={inlineEdit}",
        "            <ProjectStatusCell\n              project={item}",
    ),
    (
        "13. the card drops the lead chip (the field the card never had)",
        CARD_ROW,
        "            <ProjectLeadCell\n              project={project}\n              edit={cellEdit}\n              avatarSize={CARD_AVATAR_SIZE}\n            />",
        "",
    ),
    (
        "14. the card's lead chip is not editable (edit prop dropped)",
        CARD_ROW,
        "            <ProjectLeadCell\n              project={project}\n              edit={cellEdit}",
        "            <ProjectLeadCell\n              project={project}",
    ),
    (
        "15. em dash cells for 'no priority' stop being tappable",
        CELLS,
        """    <CellPress column="priority" edit={edit} project={project} className="gap-1.5">
      {project.priority === "none" ? (""",
        """    <View className="flex-row items-center gap-1.5">
      {project.priority === "none" ? (""",
    ),
    (
        "16. the lead sheet stops filling, so its flex-1 list collapses",
        EDITOR,
        'const fill = target.column === "lead";',
        "const fill = false;",
    ),
    (
        "17. a stale search survives into the next cell's sheet",
        EDITOR,
        "  }, [target?.project.id, target?.column]);",
        "  }, []);",
    ),
    (
        "18. the cells stop being their own tap target in the card",
        CARD_ROW,
        "  const cellEdit: ProjectInlineEdit | undefined = inlineEdit\n    ? { ...inlineEdit, selectionMode }\n    : undefined;",
        "  const cellEdit: ProjectInlineEdit | undefined = undefined;",
    ),
    (
        "19. the sheet outlives the write it starts (close after mutate)",
        EDITOR,
        """  const commit = (patch: UpdateProjectRequest) => {
    onClose();
    updateProject.mutate(patch);
  };""",
        """  const commit = (patch: UpdateProjectRequest) => {
    updateProject.mutate(patch);
    onClose();
  };""",
    ),
    (
        "20. a read-only column becomes editable (progress is not a field)",
        DECISIONS,
        'export const PROJECT_EDITABLE_COLUMNS: readonly ProjectCellColumn[] = [\n  "status",\n  "priority",\n  "lead",\n];',
        'export const PROJECT_EDITABLE_COLUMNS: readonly ProjectCellColumn[] = [\n  "status",\n  "priority",\n  "lead",\n  "progress",\n];',
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
