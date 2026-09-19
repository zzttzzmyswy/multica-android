#!/usr/bin/env python3
"""Falsify iteration 159's guards: inject the defect each guard claims to catch,
confirm the guard actually fails on it, then restore.

The 159 round closes a cross-platform gap in the workspace switcher.

**What web had and mobile did not.** Web's sidebar fetches
`GET /api/inbox/unread-summary` — an ACCOUNT-level endpoint returning one
`{workspace_id, count}` row per workspace with unread inbox items — and lights a
dot on the workspace switcher (aggregate on the avatar, per-row in the
dropdown) when a workspace OTHER than the active one has unread. Mobile had no
API method, no query and no dot, so a notification waiting in workspace B was
invisible while the user stood in workspace A.

**How it is built.** The two derivations (`hasOtherWorkspaceUnread`,
`unreadWorkspaceIds`) already existed in `packages/core/inbox/queries.ts`, but
that module imports the core ApiClient singleton and React Query — which mobile
deliberately never loads. So they moved to the import-free
`packages/core/inbox/unread-summary.ts`; `queries.ts` re-exports them (one
line, no copy), and mobile imports the same module. `apps/mobile/lib/
workspace-unread-badge.ts` adds only the mobile presentation rule (the active
workspace never gets a row dot; both signals stay off while the active id is
still unresolved) and both surfaces render from it.

Two kinds of guard, both falsified here:

  * LOGIC — `packages/core/inbox/unread-summary.test.ts` and
    `apps/mobile/lib/workspace-unread-badge.test.ts` pin the exclusion and the
    zero-count handling. Cases 1–4 break each side independently, so neither
    platform's copy can carry the other.
  * WIRING — `apps/mobile/lib/workspace-unread-wiring.test.ts` reads the
    component sources, because mobile vitest is Node-only (no RN renderer) and
    a correct pure helper that no screen calls fixes nothing. Cases 8–11 revert
    the wiring (row dot, aggregate dot, workspace gate) and case 10 replaces
    the shared import with a behaviour-identical local mirror — the iter-157
    lesson, where an inlined copy kept the contract green while the shared
    source drifted. That case is why the mirror assertion is not satisfied by
    "the tests still pass".

Green cases (must stay green — the guards are content-specific, not
churn-specific):

G1. A comment reworded in `packages/core/inbox/unread-summary.ts` leaves every
    guard alone.
G2. A comment reworded in `switch-workspace.tsx` that QUOTES the call syntax
    leaves every guard alone — the wiring guard strips comments before
    matching, so prose cannot satisfy or break it.
G3. A comment reworded in `more-tab-dropdown.tsx` leaves every guard alone.

Run from the repo root: python3 scripts/falsify-iter159-guards.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "packages/core"
MOBILE = ROOT / "apps/mobile"

CORE_SUITES = ["inbox/unread-summary.test.ts", "inbox/queries.test.ts"]
MOBILE_SUITES = [
    "lib/workspace-unread-badge.test.ts",
    "lib/workspace-unread-wiring.test.ts",
    "data/api-inbox-unread-summary.test.ts",
    "data/queries/inbox-unread-summary.test.ts",
]

CORE_UNREAD = CORE / "inbox/unread-summary.ts"
BADGE = MOBILE / "lib/workspace-unread-badge.ts"
API = MOBILE / "data/api.ts"
QUERIES = MOBILE / "data/queries/inbox.ts"
SWITCH_SHEET = MOBILE / "app/(app)/[workspace]/switch-workspace.tsx"
MORE_POPOVER = MOBILE / "components/nav/more-tab-dropdown.tsx"

# ── exact source fragments (unique in their file) ───────────────────────────

HAS_OTHER = (
    "  return summary.some((s) => s.workspace_id !== currentWsId && s.count > 0);\n"
)
HAS_OTHER_NO_EXCLUSION = "  return summary.some((s) => s.count > 0);\n"

UNREAD_IDS = (
    "  return new Set(summary.filter((s) => s.count > 0).map((s) => s.workspace_id));\n"
)
UNREAD_IDS_NO_FILTER = "  return new Set(summary.map((s) => s.workspace_id));\n"

NULL_GUARD = "  if (!activeWorkspaceId) return NONE;\n"
NULL_GUARD_LOOSE = '  if (activeWorkspaceId === "") return NONE;\n'

DELETE_ACTIVE = "  unreadIds.delete(activeWorkspaceId);\n"

SHARED_IMPORT = (
    "import {\n"
    "  hasOtherWorkspaceUnread,\n"
    "  unreadWorkspaceIds,\n"
    '} from "@multica/core/inbox/unread-summary";\n'
)
MIRROR = (
    "// Local mirror of the web derivation — behaviour identical today.\n"
    "function unreadWorkspaceIds(summary: any[]): Set<string> {\n"
    "  return new Set(summary.filter((s) => s.count > 0).map((s) => s.workspace_id));\n"
    "}\n"
    "\n"
    "function hasOtherWorkspaceUnread(\n"
    "  summary: any[],\n"
    "  currentWsId: string | null | undefined,\n"
    "): boolean {\n"
    "  return summary.some((s) => s.workspace_id !== currentWsId && s.count > 0);\n"
    "}\n"
)

API_ENDPOINT = '    const raw = await this.fetch<unknown>("/api/inbox/unread-summary", {\n'
API_ENDPOINT_WRONG = '    const raw = await this.fetch<unknown>("/api/inbox/unread-count", {\n'

API_PARSE = (
    "    return parseWithFallback(\n"
    "      raw,\n"
    "      InboxUnreadSummarySchema,\n"
    "      EMPTY_INBOX_UNREAD_SUMMARY,\n"
    '      { endpoint: "getInboxUnreadSummary" },\n'
    "    );\n"
)
API_PARSE_CAST = "    return raw as InboxWorkspaceUnread[];\n"

SUMMARY_KEY = '  unreadSummary: () => ["inbox", "unread-summary"] as const,\n'
SUMMARY_KEY_SCOPED = (
    '  unreadSummary: (wsId: string | null = null) =>\n'
    '    ["inbox", wsId, "unread-summary"] as const,\n'
)

SHEET_GATE = "    enabled: !!activeSlug,\n"
SHEET_GATE_OFF = "    enabled: true,\n"
SHEET_DOT = "              hasUnread={badge.unreadIds.has(ws.id)}\n"
SHEET_DOT_OFF = "              hasUnread={false}\n"

POPOVER_DERIVE = (
    "  const otherWorkspaceUnread = workspaceUnreadBadge(unreadSummary, wsId)\n"
    "    .showAggregateDot;\n"
)
POPOVER_DERIVE_OFF = "  const otherWorkspaceUnread = false;\n"

CORE_COMMENT = " * Pure: this module has NO runtime imports (no ApiClient, no React Query), so\n"
CORE_COMMENT_NEW = " * Pure: this module carries NO runtime imports (no ApiClient, no React Query), so\n"

# A comment that quotes the call the wiring guard looks for, verbatim.
SHEET_COMMENT = "  const badge = workspaceUnreadBadge(unreadSummary, activeId);\n"
SHEET_COMMENT_NEW = (
    "  // was: const badge = workspaceUnreadBadge(unreadSummary, activeId);\n"
    "  const badge = workspaceUnreadBadge(unreadSummary, activeId);\n"
)

POPOVER_COMMENT = "  const { data: unreadSummary = [] } = useQuery({\n"
POPOVER_COMMENT_NEW = (
    "  // enabled: !!wsId, — see the wiring guard\n"
    "  const { data: unreadSummary = [] } = useQuery({\n"
)

# ── real `it(...)` strings, character for character ─────────────────────────

# core
C_EXCLUDES_ACTIVE = "excludes the active workspace's own unread"
C_OTHER_ZERO = "ignores other workspaces whose count is zero"
C_COLLECTS_NONZERO = "collects only workspaces with a non-zero count"
C_EMPTY_SET = "returns an empty set for an empty summary"

# mobile logic
M_ACTIVE_NEVER = "never marks the active workspace — its unread is the Inbox tab count"
M_ZERO_DROPPED = "drops zero-count workspaces from both signals"
M_UNRESOLVED = "shows nothing while the active workspace is unresolved"

# mobile api
A_ENDPOINT = "GETs /api/inbox/unread-summary with the abort signal"
A_MALFORMED = "falls back to an empty summary on a malformed body"
A_MISSING = "falls back to an empty summary when rows are missing fields"
A_EXTRA = "keeps unknown extra fields rather than blanking the dot"

# mobile query
Q_ACCOUNT_KEY = "is the account-level key web uses"
Q_FLAT = "is a flat account key — no workspace id can be spliced into it"

# mobile wiring
W_SHEET_FETCH = "fetches the account-level summary, gated on the active workspace"
W_SHEET_DERIVE = "derives the dot through the shared helper"
W_SHEET_DOT = "dots the row from that derivation, not from its own scan"
W_POPOVER_DERIVE = "derives the aggregate dot through the shared helper"
W_IMPORTS_SHARED = "imports both derivations from the shared core module"
W_NO_MIRROR = "does not reimplement either derivation"

ALL_LOGIC = [
    C_EXCLUDES_ACTIVE,
    C_OTHER_ZERO,
    C_COLLECTS_NONZERO,
    C_EMPTY_SET,
    M_ACTIVE_NEVER,
    M_ZERO_DROPPED,
    M_UNRESOLVED,
    A_ENDPOINT,
    A_MALFORMED,
    A_MISSING,
    A_EXTRA,
    Q_ACCOUNT_KEY,
    Q_FLAT,
]

ALL_WIRING = [
    W_SHEET_FETCH,
    W_SHEET_DERIVE,
    W_SHEET_DOT,
    W_POPOVER_DERIVE,
    W_IMPORTS_SHARED,
    W_NO_MIRROR,
]

# (label, [(file, old, new), ...], [tests that must fail], must contain)
CASES = [
    (
        "1 core drops the active-workspace exclusion (the round's own defect)",
        [(CORE_UNREAD, HAS_OTHER, HAS_OTHER_NO_EXCLUSION)],
        [C_EXCLUDES_ACTIVE, M_ACTIVE_NEVER],
        "expected true to be false",
    ),
    (
        "2 core counts zero-count workspaces as unread",
        [(CORE_UNREAD, UNREAD_IDS, UNREAD_IDS_NO_FILTER)],
        [C_COLLECTS_NONZERO, M_ZERO_DROPPED],
        "expected true to be false",
    ),
    (
        "3 the mobile helper drops its unresolved-active-workspace guard",
        [(BADGE, NULL_GUARD, NULL_GUARD_LOOSE)],
        [M_UNRESOLVED],
        "expected 1 to be +0",
    ),
    (
        "4 the mobile helper stops excluding the active workspace from row dots",
        [(BADGE, DELETE_ACTIVE, "")],
        [M_ACTIVE_NEVER],
        "expected true to be false",
    ),
    (
        "5 the mobile api method calls the wrong inbox endpoint",
        [(API, API_ENDPOINT, API_ENDPOINT_WRONG)],
        [A_ENDPOINT],
        "/api/inbox/unread-summary",
    ),
    (
        "6 the mobile api method casts instead of schema-guarding",
        [(API, API_PARSE, API_PARSE_CAST)],
        [A_MALFORMED, A_MISSING],
        "to deeply equal",
    ),
    (
        "7 the summary query key becomes workspace-scoped",
        [(QUERIES, SUMMARY_KEY, SUMMARY_KEY_SCOPED)],
        [Q_ACCOUNT_KEY, Q_FLAT],
        "unread-summary",
    ),
    (
        "8 the switcher sheet renders rows with the dot hardwired off",
        [(SWITCH_SHEET, SHEET_DOT, SHEET_DOT_OFF)],
        [W_SHEET_DOT],
        "hasUnread={badge.unreadIds.has(ws.id)}",
    ),
    (
        "9 the switcher sheet fetches without the workspace gate",
        [(SWITCH_SHEET, SHEET_GATE, SHEET_GATE_OFF)],
        [W_SHEET_FETCH],
        "enabled: !!activeSlug",
    ),
    (
        "10 the More popover hardwires the aggregate dot off",
        [(MORE_POPOVER, POPOVER_DERIVE, POPOVER_DERIVE_OFF)],
        [W_POPOVER_DERIVE],
        "workspaceUnreadBadge(unreadSummary, wsId)",
    ),
    (
        "11 the helper mirrors the web derivation instead of importing it",
        [(BADGE, SHARED_IMPORT, MIRROR)],
        [W_IMPORTS_SHARED, W_NO_MIRROR],
        '@multica/core/inbox/unread-summary',
    ),
]

GREEN_CASES = [
    (
        "G1 a comment reworded in core unread-summary.ts leaves every guard alone",
        [(CORE_UNREAD, CORE_COMMENT, CORE_COMMENT_NEW)],
        ALL_LOGIC + ALL_WIRING,
    ),
    (
        "G2 a comment in switch-workspace.tsx QUOTING the call leaves every guard alone",
        [(SWITCH_SHEET, SHEET_COMMENT, SHEET_COMMENT_NEW)],
        ALL_LOGIC + ALL_WIRING,
    ),
    (
        "G3 a comment in more-tab-dropdown.tsx quoting the gate leaves every guard alone",
        [(MORE_POPOVER, POPOVER_COMMENT, POPOVER_COMMENT_NEW)],
        ALL_LOGIC + ALL_WIRING,
    ),
]


def vitest(cwd: Path, suites) -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", *suites, "--reporter=verbose"],
        cwd=cwd, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def all_output() -> str:
    return vitest(CORE, CORE_SUITES) + vitest(MOBILE, MOBILE_SUITES)


def red(out: str, name: str) -> bool:
    return any(name in line and ("×" in line or "✗" in line) for line in out.splitlines())


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def suites_green(out: str) -> bool:
    """Read the runner's own summary line, not the raw text.

    Substring-scanning the whole output for " failed" is wrong here: these
    guards deliberately drive `parseWithFallback` down its fallback path, so a
    PASSING run prints `[api] schema validation failed: getInboxUnreadSummary`
    to stderr. Parse `Test Files  N passed (N)` instead.
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


failures = []

for label, injections, must_fail, must_contain in CASES:
    try:
        originals = inject(injections)
    except ValueError as error:
        failures.append(f"{label}: {error}")
        print(f"MISS {label} ({error})")
        continue
    try:
        out = all_output()
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
    print(f"OK   {label}")

for label, injections, must_stay_green in GREEN_CASES:
    try:
        originals = inject(injections)
    except ValueError as error:
        failures.append(f"{label}: {error}")
        print(f"MISS {label} ({error})")
        continue
    try:
        out = all_output()
    finally:
        restore(originals)

    went_red = [name for name in must_stay_green if red(out, name)]
    if went_red:
        failures.append(f"{label}: false positive — {went_red!r} went red")
        print(f"FAIL {label}")
        continue
    print(f"OK   {label}")

print("\n-- restored state --")
for cwd, suites in ((CORE, CORE_SUITES), (MOBILE, MOBILE_SUITES)):
    out = vitest(cwd, suites)
    ok = suites_green(out)
    print(f"{'OK  ' if ok else 'FAIL'} {' + '.join(suites)}")
    if not ok:
        for line in ANSI.sub("", out).splitlines():
            if "×" in line or "FAIL " in line or "Test Files" in line:
                print(f"      {line.strip()}")
        failures.append(f"guarded suites did not return to green: {suites}")

for cwd in (CORE, MOBILE):
    result = subprocess.run(
        ["npx", "tsc", "--noEmit"], cwd=cwd, capture_output=True, text=True,
    )
    ok = "error TS" not in result.stdout + result.stderr
    print(f"{'OK  ' if ok else 'FAIL'} {cwd.name} tsc --noEmit")
    if not ok:
        failures.append(f"{cwd.name} tsc not clean after restore")

print()
if failures:
    print(f"FAILED ({len(failures)}):")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)
print("all injections caught, all boundary cases green, workspace restored.")
