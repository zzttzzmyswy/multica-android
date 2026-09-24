#!/usr/bin/env python3
"""Falsify iteration 157's guard: inject the defect the round fixes, confirm the
guard actually fails on it, then restore.

The 157 round restores a category that mobile had been silently dropping.

Board columns / list sections are CATEGORIES, and web's canonical list
(`packages/core/issues/config/status.ts`: `STATUS_ORDER` / `ALL_STATUSES`) has
seven — `cancelled` last (MUL-4290 made it first-class). Mobile kept a mirrored
six-item list in `lib/issue-status.ts` whose comment still claimed "matches web
— `cancelled` excluded". `groupIssues` and `buildSwimlaneLanes` only ever emit
columns named in the order they are handed, so a cancelled issue was bucketed
correctly and then rendered nowhere: the list, board, swimlane, My Issues and
the project issue surface all hid it. Worse, the filter sheet and picker DO
offer "Cancelled" (`status-options-core` builds its groups from all seven
categories), so selecting it matched rows server-side and drew an empty list.

Every other mobile surface already carried cancelled — the table view, the
saved-view codec, project statuses — which is what made the omission a bug
rather than a design choice.

The fix has two halves, and the guard covers both:

  * `lib/issue-status-core.ts` — a NEW pure module (no i18n/expo) holding
    `BOARD_STATUSES`, so the vitest lane can import the real constant and
    compare it against core's `STATUS_ORDER` instead of inlining a copy.
  * `groupIssues` / `buildSwimlaneLanes` actually reach it — a correct
    constant that never arrives at the grouper still renders no column.

The 151–156 lessons are applied literally:

  * The `it(...)` string a case names must match the suite's real test name
    character for character, and the injection anchor must be unique in the
    target file. The harness reports both as MISS with the count, rather than
    as a silent "the guard did not fire".
  * **The anchor has to change the thing being asserted.**
  * **A case may name more than one test that has to go red.**
  * Where two defects redden the same test, the case asserts on the failure
    MESSAGE so the two are distinguishable. Case 1 (the constant reverted) and
    case 2 (the grouper filtering cancelled out) share a symptom but not a
    message, and case 2 deliberately leaves the order assertions green.

Rules covered:

the constant
  1.  BOARD_STATUSES reverted to the six-item list — the very defect of the
      round. The mirror assertions AND the surface assertions must all go red,
      and the failure must name the missing trailing column.

the surfaces
  2.  `groupIssues` filters cancelled sections back out with the constant
      intact — the same user-visible symptom from a different cause. Only the
      grouping assertion may go red; "orders cancelled last" must stay green,
      which is what separates this case from case 1.
  3.  `buildSwimlaneLanes` drops cancelled issues — the swimlane half of the
      guard has to be load-bearing on its own.
  4.  the saved-view codec reverted to its own six-item list — a filter on
      "Cancelled" would be sanitized away when a view is opened.

Green cases (must stay green — the guard is content-specific, not churn-specific):

G1. A comment reworded in `lib/issue-status-core.ts` leaves every guard green.
G2. A comment reworded in `data/stores/issue-view-codec.ts` leaves every guard
    green: the codec assertions read the sanitized output, not the file.

Run from the repo root: python3 scripts/falsify-iter157-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps/mobile"

SUITES = [
    "lib/issue-status-core.test.ts",
    "data/stores/issue-view-codec.test.ts",
]

CORE_FILE = MOBILE / "lib/issue-status-core.ts"
FILTER_FILE = MOBILE / "lib/filter-issues.ts"
SWIMLANE_FILE = MOBILE / "lib/swimlane.ts"
CODEC_FILE = MOBILE / "data/stores/issue-view-codec.ts"

# Exact source fragments, kept as literals so the anchors are exact and unique.
STATUS_LIST = '  "blocked",\n  "cancelled",\n];\n'
STATUS_LIST_SIX = '  "blocked",\n];\n'

GROUP_FILTER = "    .filter((s) => includeEmpty || s.data.length > 0);\n"
GROUP_FILTER_DROPS_CANCELLED = (
    '    .filter((s) => s.key !== "cancelled")\n'
    "    .filter((s) => includeEmpty || s.data.length > 0);\n"
)

SWIMLANE_RENDERABLE = (
    "  const renderable = issues.filter((issue) =>\n"
    "    statusOrder.includes(issue.status),\n"
    "  );\n"
)
SWIMLANE_RENDERABLE_DROPS_CANCELLED = (
    "  const renderable = issues.filter(\n"
    '    (issue) => statusOrder.includes(issue.status) && issue.status !== "cancelled",\n'
    "  );\n"
)

CODEC_SHARED_LIST = "const ALL_STATUSES: readonly IssueStatus[] = BOARD_STATUSES;\n"
CODEC_LOCAL_SIX = (
    "const ALL_STATUSES: readonly IssueStatus[] = [\n"
    '  "backlog",\n'
    '  "todo",\n'
    '  "in_progress",\n'
    '  "in_review",\n'
    '  "done",\n'
    '  "blocked",\n'
    "];\n"
)

CORE_COMMENT = (
    " * number of custom statuses, but every one folds into one of these columns via\n"
)
CORE_COMMENT_NEW = (
    " * number of custom statuses, but each one folds into one of these columns via\n"
)
CODEC_COMMENT = (
    " * Enum lists for sanitization (mirror web baseline: unknown members drop).\n"
)
CODEC_COMMENT_NEW = (
    " * Enum lists for sanitization (mirrors web's baseline: unknown members drop).\n"
)

# Real `it(...)` strings, character for character.
MIRROR_TEST = "equals packages/core's STATUS_ORDER, cancelled included"
ORDER_LAST_TEST = "orders cancelled last, where web puts it"
COVERAGE_TEST = "covers every category the catalog can resolve an issue into"
GROUP_TEST = "groupIssues gives a cancelled issue a section of its own"
BOARD_TEST = "board mode keeps cancelled as the trailing column"
SWIMLANE_TEST = "buildSwimlaneLanes keeps cancelled issues instead of dropping them"
CODEC_TEST = "keeps a cancelled status filter (a first-class status, not an unknown)"

ALL_MIRROR_AND_SURFACE = [
    MIRROR_TEST,
    ORDER_LAST_TEST,
    COVERAGE_TEST,
    GROUP_TEST,
    BOARD_TEST,
    SWIMLANE_TEST,
]

# (label, [(file, old, new), ...], [tests that must fail], must contain, must not contain)
CASES = [
    (
        "BOARD_STATUSES reverted to the six-item list",
        [(CORE_FILE, STATUS_LIST, STATUS_LIST_SIX)],
        ALL_MIRROR_AND_SURFACE,
        "expected 'blocked' to be 'cancelled'",
        None,
    ),
    (
        "groupIssues filters cancelled back out, constant intact",
        [(FILTER_FILE, GROUP_FILTER, GROUP_FILTER_DROPS_CANCELLED)],
        [GROUP_TEST],
        "expected [] to deeply equal [ 'cancelled' ]",
        None,
    ),
    (
        "buildSwimlaneLanes drops cancelled issues",
        [(SWIMLANE_FILE, SWIMLANE_RENDERABLE, SWIMLANE_RENDERABLE_DROPS_CANCELLED)],
        [SWIMLANE_TEST],
        "expected +0 to be 1",
        None,
    ),
    (
        "saved-view codec reverted to its own six-item list",
        [(CODEC_FILE, CODEC_SHARED_LIST, CODEC_LOCAL_SIX)],
        [CODEC_TEST],
        "expected [ 'todo' ] to deeply equal [ 'cancelled', 'todo' ]",
        None,
    ),
]

GREEN_CASES = [
    (
        "G1 a comment reworded in issue-status-core.ts leaves every guard alone",
        [(CORE_FILE, CORE_COMMENT, CORE_COMMENT_NEW)],
        ALL_MIRROR_AND_SURFACE + [CODEC_TEST],
    ),
    (
        "G2 a comment reworded in issue-view-codec.ts leaves every guard alone",
        [(CODEC_FILE, CODEC_COMMENT, CODEC_COMMENT_NEW)],
        ALL_MIRROR_AND_SURFACE + [CODEC_TEST],
    ),
]


def vitest() -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", *SUITES, "--reporter=verbose"],
        cwd=MOBILE, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def red(out: str, name: str) -> bool:
    return any(name in line and ("×" in line or "✗" in line) for line in out.splitlines())


def inject(injections):
    originals = []
    for path, old, new in injections:
        src = path.read_text(encoding="utf-8")
        if src.count(old) != 1:
            raise ValueError(f"anchor not unique in {path.name} ({src.count(old)}): {old!r}")
        originals.append((path, src))
        path.write_text(src.replace(old, new, 1), encoding="utf-8")
    return originals


def restore(originals):
    for path, src in originals:
        path.write_text(src, encoding="utf-8")


failures = []

for label, injections, must_fail, must_contain, must_not_contain in CASES:
    try:
        originals = inject(injections)
    except ValueError as error:
        failures.append(f"{label}: {error}")
        print(f"MISS {label} ({error})")
        continue
    try:
        out = vitest()
    finally:
        restore(originals)

    stayed_green = [name for name in must_fail if not red(out, name)]
    if stayed_green:
        failures.append(f"{label}: guard stayed green (looked for {stayed_green!r})")
        print(f"MISS {label}")
        continue
    if must_contain and must_contain not in out:
        failures.append(f"{label}: failure did not carry {must_contain!r}")
        print(f"MISS {label} (message absent)")
        continue
    if must_not_contain and must_not_contain in out:
        failures.append(f"{label}: failure still carried {must_not_contain!r}")
        print(f"MISS {label} (wrong message present)")
        continue
    print(f"OK   {label}")

for label, injections, must_stay_green in GREEN_CASES:
    try:
        originals = inject(injections)
    except ValueError as error:
        failures.append(f"{label}: {error}")
        print(f"MISS {label} ({error})")
        continue
    try:
        out = vitest()
    finally:
        restore(originals)

    went_red = [name for name in must_stay_green if red(out, name)]
    if went_red:
        failures.append(f"{label}: false positive — {went_red!r} went red")
        print(f"FAIL {label}")
        continue
    print(f"OK   {label}")

print("\n-- restored state --")
out = vitest()
ok = " failed" not in out.split("Test Files")[-1]
print(f"{'OK  ' if ok else 'FAIL'} {' + '.join(SUITES)}")
if not ok:
    failures.append("guarded suites did not return to green after restore")

result = subprocess.run(
    ["npx", "tsc", "--noEmit"], cwd=MOBILE, capture_output=True, text=True,
)
ok = "error TS" not in result.stdout + result.stderr
print(f"{'OK  ' if ok else 'FAIL'} apps/mobile tsc --noEmit")
if not ok:
    failures.append("apps/mobile tsc not clean after restore")

print()
if failures:
    print(f"FAILED ({len(failures)}):")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)
print("all injections caught, all boundary cases green, workspace restored.")
