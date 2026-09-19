#!/usr/bin/env python3
"""Falsify iteration 162's guards: inject the defect each guard claims to catch,
confirm the guard actually fails on it, then restore.

The 162 round closes a product-parity gap on the dense issue surfaces.

**What web had and mobile did not.** Web renders
`IssueAgentActivityIndicator` in three places a user scans for "what is in
flight right now" — issue list rows
(`packages/views/issues/components/list-row.tsx:113`), board cards
(`board-card.tsx:181`) and inbox rows
(`packages/views/inbox/components/inbox-list-item.tsx:166`). Mobile rendered it
nowhere except the issue DETAIL page's `AgentActivityRow`, so a list, a board
or an inbox full of running agents looked completely idle. Verified on the real
device before the change: MYS-1279 had a `running` task and its row was
indistinguishable from MYS-443, which had none.

**How it is built.** The two projections move to core —
`packages/core/issues/surface/issue-activity.ts` owns `isQueuedTaskStatus`,
`selectIssueTasks`, `summarizeIssueActivity`, `deriveRunningIssueIds` and
`deriveIssueSurfaceActivity`. `packages/views/issues/surface/activity.ts` and
`apps/mobile/lib/running-issues.ts` become one-line re-exports, and web's
indicator component now calls the same `summarizeIssueActivity` the mobile one
does. A new `apps/mobile/components/issue/issue-agent-activity-indicator.tsx`
renders the badge from the one workspace-wide `agentTaskSnapshot` query (no new
request, no new polling) and is wired into all three rows.

Two kinds of guard, both falsified here:

  * LOGIC — `packages/core/issues/surface/issue-activity.test.ts` pins what
    counts as active (the three queued states, running beating queued, agent
    dedupe) and what the "agents working now" filter must EXCLUDE (queued-only
    issues, tasks with no issue to keep).
  * WIRING — `apps/mobile/lib/issue-agent-activity-wiring.test.ts` reads the
    three row sources and the badge source, because mobile vitest is Node-only
    (no RN renderer) and a correct selector that no row calls fixes nothing.

Run from the repo root: python3 scripts/falsify-iter162-guards.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps/mobile"
CORE = ROOT / "packages/core"

CORE_SUITES = ["issues/surface/issue-activity.test.ts"]
MOBILE_SUITES = ["lib/issue-agent-activity-wiring.test.ts"]

ACTIVITY = CORE / "issues/surface/issue-activity.ts"
INDICATOR = MOBILE / "components/issue/issue-agent-activity-indicator.tsx"
LIST_ROW = MOBILE / "components/issue/issue-row.tsx"
BOARD_CARD = MOBILE / "components/issue/board-card.tsx"
INBOX_ROW = MOBILE / "components/inbox/inbox-row.tsx"
RUNNING_ISSUES = MOBILE / "lib/running-issues.ts"

# ── exact source fragments (unique in their file) ───────────────────────────

QUEUED_BODY = (
    '    status === "queued" ||\n'
    '    status === "dispatched" ||\n'
    '    status === "waiting_local_directory"\n'
)
QUEUED_DROPS_HOLD = '    status === "queued" ||\n    status === "dispatched"\n'
QUEUED_ADDS_RUNNING = (
    '    status === "queued" ||\n'
    '    status === "running" ||\n'
    '    status === "dispatched" ||\n'
    '    status === "waiting_local_directory"\n'
)

SELECT_FILTER = "    if (task.issue_id !== issueId) continue;\n"
SELECT_FILTER_GONE = ""

PRIMARY = (
    "  const primary = groups.running.length > 0 ? groups.running : groups.queued;\n"
)
PRIMARY_QUEUED_WINS = (
    "  const primary = groups.queued.length > 0 ? groups.queued : groups.running;\n"
)
STATE = '    state: groups.running.length > 0 ? "running" : "queued",\n'
STATE_QUEUED_WINS = '    state: groups.queued.length > 0 ? "queued" : "running",\n'

DEDUPE = "    agentIds: [...new Set(primary.map((task) => task.agent_id))],\n"
DEDUPE_GONE = "    agentIds: primary.map((task) => task.agent_id),\n"

RUNNING_ONLY = '    if (task.status !== "running") continue;\n'
RUNNING_ONLY_TERMINAL_ONLY = (
    '    if (task.status === "completed" || task.status === "failed" ||\n'
    '        task.status === "cancelled") {\n'
    "      continue;\n"
    "    }\n"
)
# Two lines together: `if (!task.issue_id) continue;` also appears in
# deriveIssueSurfaceActivity, so the status line is what makes this unique.
RUNNING_AND_ISSUE_GUARD = (
    '    if (task.status !== "running") continue;\n'
    "    if (!task.issue_id) continue;\n"
)
RUNNING_ONLY_KEEPS_EVERY_ISSUE = '    if (task.status !== "running") continue;\n'

SURFACE_FILTER = (
    '    if (task.status !== "running" && !isQueuedTaskStatus(task.status)) {\n'
    "      continue;\n"
    "    }\n"
)
SURFACE_FILTER_GONE = ""

LIST_BADGE = "        <IssueAgentActivityIndicator issueId={issue.id} />\n"
LIST_BADGE_GONE = ""

BOARD_BADGE = (
    '          <IssueAgentActivityIndicator issueId={issue.id} ringClassName="bg-card" />\n'
)
BOARD_BADGE_GONE = ""

INBOX_GUARD = (
    "              {item.issue_id ? (\n"
    "                <IssueAgentActivityIndicator issueId={item.issue_id} />\n"
    "              ) : null}\n"
)
INBOX_GUARD_GONE = (
    "              <IssueAgentActivityIndicator issueId={item.issue_id} />\n"
)

SNAPSHOT_IMPORT = 'from "@/data/queries/agent-task-snapshot";'
SNAPSHOT_IMPORT_REVERTED = 'from "@/data/queries/issues";'
SNAPSHOT_CALL = "agentTaskSnapshotOptions(wsId)"
SNAPSHOT_CALL_REVERTED = "issueActiveTasksOptions(wsId, issueId)"

SELECT_BLOCK = (
    "  const select = useCallback(\n"
    "    (snapshot: AgentTask[]) =>\n"
    "      summarizeIssueActivity(selectIssueTasks(snapshot, issueId)),\n"
    "    [issueId],\n"
    "  );\n"
)
# The round's own defect class: a local copy of the derivation that no longer
# goes through the shared selector, free to drift from web's.
SELECT_BLOCK_LOCAL = (
    "  const select = useCallback((snapshot: AgentTask[]) => {\n"
    "    const running = snapshot.filter(\n"
    '      (task) => task.issue_id === issueId && task.status === "running",\n'
    "    );\n"
    "    return {\n"
    '      state: running.length > 0 ? ("running" as const) : ("idle" as const),\n'
    "      agentIds: running.map((task) => task.agent_id),\n"
    "    };\n"
    "  }, [issueId]);\n"
)

RN_IMPORT = 'import { View } from "react-native";'
RN_IMPORT_PRESSABLE = 'import { Pressable, View } from "react-native";'

REEXPORT = (
    'export { deriveRunningIssueIds } from "@multica/core/issues/surface/issue-activity";\n'
)
REEXPORT_REPLACED_BY_LOCAL = (
    "/**\n"
    " * Distinct issue ids with at least one running agent task.\n"
    " */\n"
    "export function deriveRunningIssueIds(\n"
    "  tasks: readonly AgentTask[],\n"
    "): Set<string> {\n"
    "  const ids = new Set<string>();\n"
    "  for (const task of tasks) {\n"
    '    if (task.status !== "running") continue;\n'
    "    if (!task.issue_id) continue;\n"
    "    ids.add(task.issue_id);\n"
    "  }\n"
    "  return ids;\n"
    "}\n"
)
REEXPORT_PLUS_DEAD_COPY = (
    REEXPORT
    + "\n"
    + "// A second, unused copy of the same predicate.\n"
    + "function deriveRunningIssueIdsLocal(tasks: readonly AgentTask[]) {\n"
    + "  const ids = new Set<string>();\n"
    + "  for (const task of tasks) {\n"
    + '    if (task.status !== "running") continue;\n'
    + "    ids.add(task.issue_id);\n"
    + "  }\n"
    + "  return ids;\n"
    + "}\n"
)

# ── comment rewrites for the green cases ────────────────────────────────────

ACTIVITY_COMMENT = " * No runtime imports: mobile imports this directly and its modules must stay\n"
ACTIVITY_COMMENT_NEW = " * No runtime imports: the mobile bundle imports this directly, so it must stay\n"

INBOX_COMMENT = (
    "              {/* Badge only, no drill-down — mirrors web's\n"
)
INBOX_COMMENT_NEW = (
    "              {/* Badge only, no drill-down — mirrors web's\n"
    "                  `{item.issue_id ? (` guard, which keeps an issue-less\n"
    "                  notification row from asking about \"\".\n"
)

INDICATOR_COMMENT = (
    " * costs no extra request and no extra polling. The `select` keeps the returned\n"
)
INDICATOR_COMMENT_NEW = (
    " * costs no extra request and no extra polling. We deliberately do NOT reach\n"
    " * for `issueActiveTasksOptions(wsId, issueId)` here: one request per visible\n"
    " * row is exactly what the shared snapshot exists to avoid. The `select` keeps\n"
    " * the returned\n"
)

# ── real `it(...)` strings, character for character ─────────────────────────

# core logic
L_QUEUED_TRUE = "counts the three non-terminal waiting states as queued"
L_QUEUED_FALSE = "does not count running or any terminal state as queued"
L_SELECT = "keeps only this issue's non-terminal tasks, bucketed"
L_SELECT_EMPTY = "returns empty buckets when the issue has no tasks at all"
L_SUM_IDLE = "is idle with no agents when nothing is in flight"
L_SUM_QUEUED = "reports queued with the queued agents when nothing is running"
L_SUM_RUNNING_WINS = "lets running win over queued, and stacks only the running agents"
L_SUM_DEDUPE = "collapses an agent's parallel tasks to one avatar"
L_RUN_IDS = "collects distinct issue ids with a running task"
L_RUN_IDS_EXCL_QUEUED = (
    "excludes queued states — the filter promises an agent is on it now"
)
L_RUN_IDS_NO_ISSUE = "skips tasks with no issue to keep"
L_SURFACE = "buckets every non-terminal task by issue and derives the running set"

# mobile wiring
W_LIST = "renders the badge in the issue list row, keyed on the issue id"
W_BOARD = "renders the badge on the board card, keyed on the issue id"
W_INBOX = "renders the badge in the inbox row, keyed on the row's issue id"
W_INBOX_GUARD = "keeps the inbox row's guard against issue-less notifications"
W_SNAPSHOT = "reads the one workspace-wide task snapshot"
W_NO_PER_ROW = "adds no per-row task request"
W_SELECTOR = "narrows the snapshot through the shared core selector"
W_SELECT = "subscribes with a select so unrelated task moves skip the row"
W_CUE = "stays a cue, not a second tap target inside the row"
W_REEXPORT = "re-exports the core projection instead of restating it"
W_NO_LOCAL_PREDICATE = "carries no local copy of the running predicate"

CORE_GUARDS = [
    L_QUEUED_TRUE, L_QUEUED_FALSE, L_SELECT, L_SELECT_EMPTY, L_SUM_IDLE,
    L_SUM_QUEUED, L_SUM_RUNNING_WINS, L_SUM_DEDUPE, L_RUN_IDS,
    L_RUN_IDS_EXCL_QUEUED, L_RUN_IDS_NO_ISSUE, L_SURFACE,
]
MOBILE_GUARDS = [
    W_LIST, W_BOARD, W_INBOX, W_INBOX_GUARD, W_SNAPSHOT, W_NO_PER_ROW,
    W_SELECTOR, W_SELECT, W_CUE, W_REEXPORT, W_NO_LOCAL_PREDICATE,
]

# (label, suite, [(file, old, new), ...], [tests that must fail], must contain)
CASES = [
    (
        "1 isQueuedTaskStatus drops the on-disk hold state",
        "core",
        [(ACTIVITY, QUEUED_BODY, QUEUED_DROPS_HOLD)],
        [L_QUEUED_TRUE],
        "expected false to be true",
    ),
    (
        "2 isQueuedTaskStatus swallows running",
        "core",
        [(ACTIVITY, QUEUED_BODY, QUEUED_ADDS_RUNNING)],
        [L_QUEUED_FALSE],
        "expected true to be false",
    ),
    (
        "3 selectIssueTasks stops filtering by issue",
        "core",
        [(ACTIVITY, SELECT_FILTER, SELECT_FILTER_GONE)],
        [L_SELECT, L_SELECT_EMPTY],
        "expected",
    ),
    (
        "4 summarizeIssueActivity lets queued beat running",
        "core",
        [
            (ACTIVITY, PRIMARY, PRIMARY_QUEUED_WINS),
            (ACTIVITY, STATE, STATE_QUEUED_WINS),
        ],
        [L_SUM_RUNNING_WINS],
        "expected",
    ),
    (
        "5 summarizeIssueActivity stops collapsing an agent's parallel tasks",
        "core",
        [(ACTIVITY, DEDUPE, DEDUPE_GONE)],
        [L_SUM_DEDUPE],
        "expected",
    ),
    (
        "6 deriveRunningIssueIds counts queued work as an agent being on it",
        "core",
        [(ACTIVITY, RUNNING_ONLY, RUNNING_ONLY_TERMINAL_ONLY)],
        [L_RUN_IDS_EXCL_QUEUED, L_SURFACE],
        "expected",
    ),
    (
        "7 deriveRunningIssueIds stops skipping tasks with no issue",
        "core",
        [(ACTIVITY, RUNNING_AND_ISSUE_GUARD, RUNNING_ONLY_KEEPS_EVERY_ISSUE)],
        [L_RUN_IDS_NO_ISSUE, L_SURFACE],
        "expected",
    ),
    (
        "8 deriveIssueSurfaceActivity buckets terminal tasks too",
        "core",
        [(ACTIVITY, SURFACE_FILTER, SURFACE_FILTER_GONE)],
        [L_SURFACE],
        "expected",
    ),
    (
        "9 the issue list row stops rendering the badge",
        "mobile",
        [(LIST_ROW, LIST_BADGE, LIST_BADGE_GONE)],
        [W_LIST],
        "IssueAgentActivityIndicator",
    ),
    (
        "10 the board card stops rendering the badge",
        "mobile",
        [(BOARD_CARD, BOARD_BADGE, BOARD_BADGE_GONE)],
        [W_BOARD],
        "IssueAgentActivityIndicator",
    ),
    (
        "11 the inbox row drops its issue_id guard",
        "mobile",
        [(INBOX_ROW, INBOX_GUARD, INBOX_GUARD_GONE)],
        [W_INBOX_GUARD],
        r"to match /\{item\.issue_id \? \(/",
    ),
    (
        "12 the badge switches to a per-row task request",
        "mobile",
        [
            (INDICATOR, SNAPSHOT_IMPORT, SNAPSHOT_IMPORT_REVERTED),
            (INDICATOR, SNAPSHOT_CALL, SNAPSHOT_CALL_REVERTED),
        ],
        [W_SNAPSHOT, W_NO_PER_ROW, W_SELECT],
        "agent-task-snapshot",
    ),
    (
        "13 the badge stops going through the shared core selector",
        "mobile",
        [(INDICATOR, SELECT_BLOCK, SELECT_BLOCK_LOCAL)],
        [W_SELECTOR],
        # Vitest truncates both sides with an ellipsis, so match the regex
        # literal's head — the `\(selectIssueTasks...` tail is cut off.
        "to match /summarizeIssueActivity",
    ),
    (
        "14 the badge becomes a second tap target inside the row",
        "mobile",
        [(INDICATOR, RN_IMPORT, RN_IMPORT_PRESSABLE)],
        [W_CUE],
        "Pressable",
    ),
    (
        "15 running-issues.ts restates the projection locally",
        "mobile",
        [(RUNNING_ISSUES, REEXPORT, REEXPORT_REPLACED_BY_LOCAL)],
        [W_REEXPORT, W_NO_LOCAL_PREDICATE],
        "deriveRunningIssueIds",
    ),
    (
        "16 running-issues.ts keeps a second, drifting copy of the predicate",
        "mobile",
        [(RUNNING_ISSUES, REEXPORT, REEXPORT_PLUS_DEAD_COPY)],
        [W_NO_LOCAL_PREDICATE],
        r'to match /task\.status !== "running"/',
    ),
]

GREEN_CASES = [
    (
        "G1 a comment reworded in issue-activity.ts leaves every core guard alone",
        "core",
        [(ACTIVITY, ACTIVITY_COMMENT, ACTIVITY_COMMENT_NEW)],
        CORE_GUARDS,
    ),
    (
        "G2 a comment in the inbox row QUOTING the dropped guard leaves the guard alone",
        "mobile",
        [(INBOX_ROW, INBOX_COMMENT, INBOX_COMMENT_NEW)],
        MOBILE_GUARDS,
    ),
    (
        "G3 a comment in the badge naming the per-row query it must not use leaves the guard alone",
        "mobile",
        [(INDICATOR, INDICATOR_COMMENT, INDICATOR_COMMENT_NEW)],
        MOBILE_GUARDS,
    ),
]


def vitest(suite: str, suites) -> str:
    cwd = CORE if suite == "core" else MOBILE
    result = subprocess.run(
        ["npx", "vitest", "run", *suites, "--reporter=verbose"],
        cwd=cwd, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def red(out: str, name: str) -> bool:
    return any(name in line and ("×" in line or "✗" in line) for line in out.splitlines())


def suites_green(out: str) -> bool:
    """Read the runner's own summary line, not the raw text.

    Substring-scanning the whole output for " failed" is wrong here: these
    guards read component sources, and a failing assertion prints the whole
    file body, which can contain the word "failed" in the injected text. Parse
    `Test Files  N passed (N)` instead.
    """
    summary = re.search(r"^ +Test Files .*$", ANSI.sub("", out), re.M)
    return summary is not None and " failed" not in summary.group(0)


def inject(injections):
    """Apply every injection, then hand back one original per file.

    Read each file once and write it once: recording an original per injection
    would leave a file with several injections half-restored, since the last
    write wins and it already carries the earlier ones (the 158 defect).
    """
    by_file = {}
    for path, old, new in injections:
        src = by_file.get(path)
        if src is None:
            src = path.read_text(encoding="utf-8")
        if src.count(old) != 1:
            raise ValueError(f"anchor not unique in {path.name} ({src.count(old)}): {old!r}")
        by_file[path] = src.replace(old, new, 1)

    originals = []
    for path, _, _ in injections:
        if path in by_file:
            originals.append((path, path.read_text(encoding="utf-8")))
            path.write_text(by_file.pop(path), encoding="utf-8")
    return originals


def restore(originals):
    for path, src in originals:
        path.write_text(src, encoding="utf-8")


# Snapshot before the first injection. Comparing against git HEAD would flag
# the round's own uncommitted work as a failed restore.
PRISTINE = {
    path: path.read_text(encoding="utf-8")
    for path in (ACTIVITY, INDICATOR, LIST_ROW, BOARD_CARD, INBOX_ROW, RUNNING_ISSUES)
}


failures = []

for label, suite, injections, must_fail, must_contain in CASES:
    try:
        originals = inject(injections)
    except ValueError as error:
        failures.append(f"{label}: {error}")
        print(f"MISS {label} ({error})")
        continue
    try:
        out = vitest(suite, CORE_SUITES if suite == "core" else MOBILE_SUITES)
    finally:
        restore(originals)

    stayed_green = [name for name in must_fail if not red(out, name)]
    if stayed_green:
        failures.append(f"{label}: guard stayed green (looked for {stayed_green!r})")
        print(f"MISS {label}")
        continue
    if must_contain and must_contain not in ANSI.sub("", out):
        failures.append(f"{label}: failure did not carry {must_contain!r}")
        print(f"MISS {label} (message absent)")
        continue
    print(f"OK   {label}")

for label, suite, injections, must_stay_green in GREEN_CASES:
    try:
        originals = inject(injections)
    except ValueError as error:
        failures.append(f"{label}: {error}")
        print(f"MISS {label} ({error})")
        continue
    try:
        out = vitest(suite, CORE_SUITES if suite == "core" else MOBILE_SUITES)
    finally:
        restore(originals)

    went_red = [name for name in must_stay_green if red(out, name)]
    if went_red:
        failures.append(f"{label}: false positive — {went_red!r} went red")
        print(f"FAIL {label}")
        continue
    print(f"OK   {label}")

print("\n-- restored state --")
for suite, suites in (("core", CORE_SUITES), ("mobile", MOBILE_SUITES)):
    out = vitest(suite, suites)
    ok = suites_green(out)
    print(f"{'OK  ' if ok else 'FAIL'} {' + '.join(suites)}")
    if not ok:
        for line in ANSI.sub("", out).splitlines():
            if "×" in line or "FAIL " in line or "Test Files" in line:
                print(f"      {line.strip()}")
        failures.append(f"guarded suite did not return to green: {suites}")

for path, before in PRISTINE.items():
    if path.read_text(encoding="utf-8") != before:
        failures.append(f"{path} left modified after restore")

if failures:
    print("\nFAILURES:")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)

print("\nall iter162 guards falsified")
