#!/usr/bin/env python3
"""Mutation-test iteration 251's "a failed read is not a conclusion" fix
(MYS-2192).

The defect is a conclusion rendered from an unanswered request, and that shape
half-fixes very easily: the banner alone leaves the row still printing
「未使用」 and a read-only lock under it, so the screen LOOKS explained while the
cells keep stating facts nobody measured; the cells alone leave the failure with
no name anywhere. Each mutation injects exactly ONE such half-defect and asserts
the suite turns RED; the restore is asserted GREEN. A guard that cannot be made
to fail is not a guard — the repo's standing discipline
(`scripts/falsify-*.py`).

The shapes, mirroring the issue's acceptance criteria:

   1. the banner gate is constant `false`                (never shown)
   2. the banner gate is negated                         (inverted)
   3. the gate watches loading instead of error          (fires on every open)
   4. only the list page is wired; the detail page keeps the pre-fix gate
   5. the banner copy is swapped for the other surface's key
   6. the list row still renders 「未使用」 off the raw length (pre-fix shape)
   7. the used-by cell ignores `resolved` (decides from the count alone)
   8. the lock ignores `membersResolved` (pre-fix `canEdit ? pencil : lock`)
   9. the list stops passing the settlement flags into `buildSkillRows`
  10. `buildSkillRows` defaults the flags to unsettled
      (every unrelated surface suddenly says "unknown")
  11. the detail page still renders the empty panel off the raw length
  12. the detail header count is ungated again
  13. the record's flags are hard-coded settled at the call site
  14. the memo stops depending on the resolved flags
      (a read that fails after the rows were built leaves them asserting)

Run: python3 scripts/falsify-iter251-supporting-data.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
LIST = APP / "app" / "(app)" / "[workspace]" / "more" / "skills.tsx"
DETAIL = APP / "app" / "(app)" / "[workspace]" / "more" / "skills" / "[id].tsx"
ROWS = APP / "lib" / "filter-skills.ts"

SUITE = [
    "lib/skill-supporting-data.test.ts",
    "lib/skill-supporting-data-wiring.test.ts",
    "lib/filter-skills.test.ts",
    "lib/skill-row-actions.test.ts",
    "lib/i18n/iter251-keys.test.ts",
]

# Verbatim anchors from the fixed source, so a mutation recreates the exact
# pre-fix shape rather than a paraphrase of it.
LIST_GATE = """        {supportingDataWarningVisible({
          agents: agentsRead.state,
          members: membersRead.state,
        }) ? (
          <SupportingDataWarning
            message={t("skills.list.supportingDataWarning")}
          />
        ) : null}"""

LIST_GATE_DISABLED = """        {false ? (
          <SupportingDataWarning
            message={t("skills.list.supportingDataWarning")}
          />
        ) : null}"""

USED_BY_CELL = "  const verdict = usedByCell(agents.length, resolved);"
LOCK_CELL = "  const lockVerdict = skillLockCell(canEdit, membersResolved);"

DETAIL_GATE = """        {supportingDown ? (
          <SupportingDataWarning
            message={t("skills.detail.supportingDataWarning")}
          />
        ) : null}"""

DETAIL_GATE_REPLACEMENT = """        {supportingDataWarningVisible({
          agents: agentsRead.state,
          members: membersRead.state,
        }) ? (
          <View />
        ) : null}"""


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
        "1. the banner gate is constant `false` — the failure is never named",
        APP / "lib" / "skill-supporting-data.ts",
        "  return states.agents === \"error\" || states.members === \"error\";",
        "  return false;",
    ),
    (
        "2. the banner gate is negated — a healthy page wears the warning",
        APP / "lib" / "skill-supporting-data.ts",
        "  return states.agents === \"error\" || states.members === \"error\";",
        "  return states.agents !== \"error\" && states.members !== \"error\";",
    ),
    (
        "3. the gate watches `loading` instead of `error`",
        APP / "lib" / "skill-supporting-data.ts",
        "  return states.agents === \"error\" || states.members === \"error\";",
        "  return states.agents === \"loading\" || states.members === \"loading\";",
    ),
    (
        "4. only the list page is wired — the detail page keeps the pre-fix gate",
        DETAIL,
        DETAIL_GATE,
        DETAIL_GATE_REPLACEMENT,
    ),
    (
        "5. the list banner is worded with the detail page's key",
        LIST,
        't("skills.list.supportingDataWarning")',
        't("skills.detail.supportingDataWarning")',
    ),
    (
        "6. the list row is back to asserting 「未使用」 off the raw length",
        LIST,
        USED_BY_CELL,
        "  const verdict: UsedByCell = agents.length > 0 ? \"agents\" : \"unused\";",
    ),
    (
        "7. the used-by cell decides from the count alone, ignoring `resolved`",
        APP / "lib" / "skill-supporting-data.ts",
        "  if (agentCount > 0) return \"agents\";\n  return agentsResolved ? \"unused\" : \"unknown\";",
        "  return agentCount > 0 ? \"agents\" : \"unused\";",
    ),
    (
        "8. the lock ignores `membersResolved` — the pre-fix ternary",
        LIST,
        LOCK_CELL,
        "  const lockVerdict: SkillLockCell = canEdit ? \"pencil\" : \"lock\";",
    ),
    (
        "9. the list stops passing the settlement flags to `buildSkillRows`",
        LIST,
        """        agentsResolved: agentsRead.isResolved,
        membersResolved: membersRead.isResolved,""",
        "",
    ),
    (
        "10. `buildSkillRows` defaults the flags to unsettled",
        ROWS,
        "  agentsResolved = true,\n  membersResolved = true,",
        "  agentsResolved = false,\n  membersResolved = false,",
    ),
    (
        "11. the detail page claims 「not assigned yet」 off the raw length",
        DETAIL,
        """          {usedByVerdict === "status" ? (""",
        """          {usedByAgents.length === 0 ? (""",
    ),
    (
        "12. the detail header count is ungated again",
        DETAIL,
        "                usedByTotal === null\n                  ? t(\"skills.usedBy.titlePlain\")\n                  : usedByTotal === 1",
        "                usedByAgents.length === 1",
    ),
    (
        "13. the detail page hard-codes the counts as settled",
        DETAIL,
        """  const usedByVerdict = usedBySection(
    usedByAgents.length,
    agentsRead.isResolved,
  );
  const usedByTotal = usedByCount(usedByAgents.length, agentsRead.isResolved);""",
        """  const usedByVerdict = usedBySection(usedByAgents.length, true);
  const usedByTotal = usedByCount(usedByAgents.length, true);""",
    ),
    (
        "14. the rows memo stops depending on the resolved flags",
        LIST,
        """      agentsRead.isResolved,
      membersRead.isResolved,
    ],""",
        """    ],""",
    ),
]


def main() -> int:
    green, tail = run_suite()
    print(f"baseline: {'GREEN' if green else 'RED'}")
    if not green:
        print(tail)
        return 1

    failures: list[str] = []
    for name, path, before, after in MUTATIONS:
        original = path.read_text()
        if before not in original:
            print(f"[SKIP] {name}: anchor not found in {path.name} — anchor is stale")
            failures.append(name)
            continue
        if original.count(before) != 1:
            print(f"[SKIP] {name}: anchor appears {original.count(before)}x in {path.name}")
            failures.append(name)
            continue
        path.write_text(original.replace(before, after, 1))
        try:
            mutated_green, _ = run_suite()
        finally:
            path.write_text(original)
        restored_green, _ = run_suite()
        if mutated_green:
            print(f"[FAIL] {name}: still GREEN — the guard does not cover it")
            failures.append(name)
        elif not restored_green:
            print(f"[FAIL] {name}: restore did not return GREEN")
            failures.append(name)
        else:
            print(f"[OK]   {name}: turned RED")

    if failures:
        print(f"\n{len(failures)} mutation(s) not covered:")
        for name in failures:
            print(f"  - {name}")
        return 1

    print(f"\nall {len(MUTATIONS)} mutations turned RED and restored GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
