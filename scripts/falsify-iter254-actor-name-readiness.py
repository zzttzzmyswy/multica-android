#!/usr/bin/env python3
"""Mutation-test iteration 254's "a name is only asserted once its directory
answered" change (MYS-2215).

The defect was a *fold*: `data/use-actor-name.ts`'s `getName` returns the same
string for "the read is still in flight" and "this actor is genuinely gone", so
the issue table's assignee and creator columns printed 「Unknown」 /
「Unknown Agent」 on every row of a cold start — a statement of fact about an
actor nobody had looked up yet. `useActorLookup` had computed the flag that
separates the two for three rounds; it had exactly one consumer.

That shape mutates deceptively, because the *rendered* result of half the
plausible edits is identical on a warm cache:

  - the decision reading `name` before checking readiness (works warm, prints
    "Unknown" cold — the defect itself, restored);
  - readiness taken from one directory and applied to all three types (works
    for members, blanks every agent name whenever the member list is slow);
  - a `gone` actor collapsing into a blank cell instead of its id fragment
    (two different missing actors become indistinguishable);
  - the table's memo comparator not seeing the resolver, so the cell freezes
    at its cold-start state and never repaints;
  - the creator column left on raw `getName` while the assignee column is
    fixed (half the surface, and the half a reviewer is less likely to open);
  - the avatar keeping `getInitials("Unknown")` = "U" (a grey disc stamped "U"
    on every row: the same claim in a smaller font);
  - a header (board column, swimlane lane) falling back to the empty sentence
    instead of a reading mark — asserting an absence it never measured.

Each mutation injects exactly ONE such half-defect and asserts the suite turns
RED; the restore is then asserted GREEN. A guard that cannot be made to fail is
not a guard (the repo's standing discipline, `scripts/falsify-*.py`).

Run: python3 scripts/falsify-iter254-actor-name-readiness.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
DECISIONS = APP / "lib" / "actor-name-state.ts"
LOOKUP = APP / "data" / "use-actor-name.ts"
PRIMITIVE = APP / "components" / "ui" / "actor-name.tsx"
TABLE = APP / "components" / "issue" / "table-view.tsx"
ROW = APP / "components" / "issue" / "issue-row.tsx"
CARD = APP / "components" / "issue" / "board-card.tsx"
BOARD = APP / "components" / "issue" / "board-view.tsx"
SWIMLANE = APP / "components" / "issue" / "swimlane-view.tsx"
AVATAR = APP / "components" / "ui" / "actor-avatar.tsx"
PROJECT = APP / "lib" / "project-inline-edit.ts"

SUITE = [
    "lib/actor-name-state.test.ts",
    "lib/actor-name-wiring.test.ts",
    "lib/i18n/iter254-keys.test.ts",
    "lib/project-inline-edit.test.ts",
    "lib/project-inline-edit-wiring.test.ts",
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
        "1. the decision reads the name before checking readiness (the bug)",
        DECISIONS,
        '  if (!isActorTypeResolved(readiness, type)) return { kind: "unsettled" };',
        "  // readiness check removed",
    ),
    (
        "2. a failed read counts as answered (error folded into settled)",
        DECISIONS,
        "  const settled = (value: CatalogState | boolean) =>\n"
        "    typeof value === \"boolean\" ? value : isCatalogResolved(value);",
        "  const settled = (value: CatalogState | boolean) =>\n"
        "    typeof value === \"boolean\" ? value : value !== \"loading\";",
    ),
    (
        "3. every type is gated on the member directory",
        DECISIONS,
        "  if (type === \"member\" || type === \"agent\" || type === \"squad\") {\n"
        "    return readiness[type];\n"
        "  }",
        "  if (type === \"member\" || type === \"agent\" || type === \"squad\") {\n"
        "    return readiness.member;\n"
        "  }",
    ),
    (
        "4. an unknown type is called resolved (asserts with no read behind it)",
        DECISIONS,
        "  return false;\n}",
        "  return true;\n}",
    ),
    (
        "5. a settled absence is reported as a name (prints the sentinel)",
        DECISIONS,
        '  if (isResolvedActorName(name)) return { kind: "name", name };\n'
        '  return { kind: "gone", name: id.slice(0, GONE_ID_FRAGMENT) };',
        '  return { kind: "name", name };',
    ),
    (
        "6. a gone actor collapses to a blank instead of its id fragment",
        DECISIONS,
        '  return { kind: "gone", name: id.slice(0, GONE_ID_FRAGMENT) };',
        '  return { kind: "gone", name: "" };',
    ),
    (
        "7. the sentinel list stops recognising a real fallback",
        DECISIONS,
        '  "Unknown Agent",\n',
        "",
    ),
    (
        "8. the lookup reports every directory resolved",
        LOOKUP,
        "      member: membersRead.isResolved,\n"
        "      agent: agentsRead.isResolved,\n"
        "      squad: squadsRead.isResolved,",
        "      member: true,\n"
        "      agent: true,\n"
        "      squad: true,",
    ),
    (
        "9. the squad directory goes back to the state-less read",
        LOOKUP,
        "  const squadsRead = catalogRead(useQuery(squadListOptions(wsId)));",
        "  const squadsRead = { items: useQuery(squadListOptions(wsId)).data ?? [], "
        "isResolved: true };",
    ),
    (
        "10. the lookup decides inline instead of through the primitive",
        LOOKUP,
        "      return actorNameState({ type, id, name, readiness: resolvedBy });",
        "      return { kind: \"name\" as const, name };",
    ),
    (
        # The string form is the one piece of the primitive the Node lane can
        # call directly, so these two attack it there.
        "11. the string form leaks a placeholder for an unsettled reference",
        DECISIONS,
        '  return state.kind === "unsettled" ? "" : state.name;',
        '  return state.kind === "unsettled" ? "Unknown" : state.name;',
    ),
    (
        "12. the string form drops the id fragment for a gone actor",
        DECISIONS,
        '  return state.kind === "unsettled" ? "" : state.name;',
        '  return state.kind === "gone" ? "" : state.name;',
    ),
    (
        "13. the table's assignee cell goes back to raw getName",
        TABLE,
        "        <ActorNameLabel\n"
        "          type={issue.assignee_type}\n"
        "          id={issue.assignee_id}\n"
        "          empty={empty}\n"
        "          state={resolveActorName(issue.assignee_type, issue.assignee_id)}",
        "        <ActorNameLabel\n"
        "          type={issue.assignee_type}\n"
        "          id={issue.assignee_id}\n"
        "          empty={empty}\n"
        "          state={{ kind: \"name\", name: getName(issue.assignee_type, issue.assignee_id) }}",
    ),
    (
        "14. the table's creator cell goes back to raw getName",
        TABLE,
        "        <ActorNameText\n"
        "          state={resolveActorName(issue.creator_type, issue.creator_id)}",
        "        <ActorNameText\n"
        "          state={{ kind: \"name\", name: getName(issue.creator_type, issue.creator_id) }}",
    ),
    (
        "15. the memo comparator stops seeing the resolver (cell freezes cold)",
        TABLE,
        "    prev.resolveActorName === next.resolveActorName &&\n",
        "",
    ),
    (
        "16. the resolver stops reaching DataCell (prop dropped at the call)",
        TABLE,
        "                      resolveActorName={resolveActorName}\n",
        "",
    ),
    (
        "17. actor-valued property cells keep the raw lookup",
        TABLE,
        "              .map((ref) => actorNameText(resolveActorName(ref.kind, ref.id)))",
        "              .map((ref) => getName(ref.kind, ref.id))",
    ),
    (
        "18. the issue row's avatar label names an unresolved actor",
        ROW,
        "              const name = actorNameText(\n"
        "                resolveActorName(issue.assignee_type, issue.assignee_id),\n"
        "              );",
        "              const name = getName(issue.assignee_type, issue.assignee_id);",
    ),
    (
        "19. the board card's chips get the raw resolver back",
        CARD,
        "    [resolveActorName],",
        "    [],",
    ),
    (
        "20. a chip with nothing known is drawn empty instead of dropped",
        CARD,
        '            if (display.kind === "actors" && !chip.text) return null;\n',
        "",
    ),
    (
        "21. the board's assignee column header names an unresolved actor",
        BOARD,
        "      actorNameText(resolveActorName(column.assigneeType, column.assigneeId)) ||\n"
        "      translate(\"issues.boardReadingAssignee\");",
        "      getName(column.assigneeType, column.assigneeId);",
    ),
    (
        "22. the swimlane lane header names an unresolved actor",
        SWIMLANE,
        "          actorNameText(actorNameState(lane.assigneeType, lane.assigneeId)) ||\n"
        "          t(\"issues.swimlane.loadingLane\")",
        "          actorName(lane.assigneeType, lane.assigneeId)",
    ),
    (
        "23. the avatar stamps initials from an unresolved name",
        AVATAR,
        "  const name = actorNameText(resolveActorName(type, id));",
        "  const name = getName(type, id);",
    ),
    (
        "24. the avatar's profile label announces an unresolved name",
        AVATAR,
        "          const name = actorNameText(resolveActorName(type, id));",
        "          const name = getName(type, id);",
    ),
    (
        "25. the projects lead cell's gate widens to every directory",
        LOOKUP,
        "  const resolved = resolvedBy.member && resolvedBy.agent;",
        "  const resolved = resolvedBy.member && resolvedBy.agent && resolvedBy.squad;",
    ),
    (
        "26. the shared sentinel list grows back into two copies",
        PROJECT,
        'export { isResolvedActorName, UNRESOLVED_ACTOR_NAMES } from "./actor-name-state";\n'
        'import { isResolvedActorName } from "./actor-name-state";',
        "function isResolvedActorName(name: string): boolean {\n"
        "  return name.length > 0 && name !== \"Unknown\";\n"
        "}\n"
        "export { isResolvedActorName };",
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
