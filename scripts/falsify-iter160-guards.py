#!/usr/bin/env python3
"""Falsify iteration 160's guards: inject the defect each guard claims to catch,
confirm the guard actually fails on it, then restore.

The 160 round closes a product-parity gap in the issue assignee picker.

**What web had and mobile did not.** Web's assignee picker renders a lock next
to every agent that is not workspace-wide
(`packages/views/issues/components/pickers/assignee-picker.tsx`), so the person
assigning work can see that an agent is restricted before they pick it. Mobile
rendered the agent rows with no such signal: a private agent and a
workspace-wide agent looked identical.

**How it is built.** The three-state scope derivation already existed in
`apps/mobile/lib/agent-access.ts` (mirroring `@multica/core/agents`), and
`lib/agent-list-access.ts` already owned the list's access surface. The round
adds `isRestrictedAgent` there — scope !== "workspace" — and the picker row
renders the lock from it. Deliberately NOT from the legacy `visibility` field:
the lock is a claim about who may RUN the agent, and `visibility` is the lossy
two-state projection that MUL-3963 replaced.

Two kinds of guard, both falsified here:

  * LOGIC — `apps/mobile/lib/agent-list-access.test.ts` pins the predicate:
    both non-workspace scopes read as restricted, the workspace scope does not,
    and a stale `visibility` value never overrides the authoritative fields.
  * WIRING — `apps/mobile/lib/assignee-restricted-lock-wiring.test.ts` reads
    the component source, because mobile vitest is Node-only (no RN renderer)
    and a correct pure helper that no row calls fixes nothing. Cases 4–7 revert
    the render, the gate, the a11y treatment, and the shared import (case 7
    swaps in a behaviour-identical local mirror reading the legacy field — the
    iter-157 lesson, where an inlined copy kept the contract green while the
    shared source drifted).

Case 4 and case 5 both turn the gate test red, so the two are told apart by
WHICH tests fail: removing the block also kills the icon and the a11y
assertions, while hardwiring the gate leaves those green.

Green cases (must stay green — the guards are content-specific, not
churn-specific):

G1. A comment reworded in `lib/agent-list-access.ts` leaves every guard alone.
G2. A comment in the picker that QUOTES the gate call verbatim leaves every
    guard alone — the wiring guard strips comments before matching, so prose
    can neither satisfy nor break it.
G3. A comment in the picker that mentions `.visibility` leaves the
    "never reads the legacy visibility field" guard alone — otherwise a note
    explaining WHY the field is avoided would trip the guard it documents.

Run from the repo root: python3 scripts/falsify-iter160-guards.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps/mobile"

MOBILE_SUITES = [
    "lib/agent-list-access.test.ts",
    "lib/assignee-restricted-lock-wiring.test.ts",
]

LIST_ACCESS = MOBILE / "lib/agent-list-access.ts"
PICKER_BODY = MOBILE / "components/issue/pickers/assignee-picker-body.tsx"

# ── exact source fragments (unique in their file) ───────────────────────────

RESTRICTED_BODY = '  return accessScopeOfAgent(agent) !== "workspace";\n'
RESTRICTED_INVERTED = '  return accessScopeOfAgent(agent) === "workspace";\n'
RESTRICTED_MEMBER_BLIND = '  return accessScopeOfAgent(agent) === "owner-only";\n'
RESTRICTED_LEGACY = (
    '  return (agent as { visibility?: string }).visibility !== "workspace";\n'
)

SHARED_IMPORT = 'import { isRestrictedAgent } from "@/lib/agent-list-access";\n'
LOCAL_MIRROR = (
    "// Local mirror of the shared predicate — behaviour identical today.\n"
    "function isRestrictedAgent(agent: { visibility?: string }): boolean {\n"
    '  return agent.visibility !== "workspace";\n'
    "}\n"
)

LOCK_BLOCK = (
    '          {item.kind === "agent" && isRestrictedAgent(item.agent) ? (\n'
    "            <Ionicons\n"
    '              name="lock-closed-outline"\n'
    "              size={14}\n"
    "              color={mutedColor}\n"
    "              accessibilityElementsHidden\n"
    '              importantForAccessibility="no"\n'
    "            />\n"
    "          ) : null}\n"
)

GATE = 'item.kind === "agent" && isRestrictedAgent(item.agent) ? ('
GATE_HARDWIRED = 'item.kind === "agent" && true ? ('

A11Y_PROP = "              accessibilityElementsHidden\n"
A11Y_PROP_OFF = ""

LIST_ACCESS_COMMENT = (
    " * signal behind the lock in the issue assignee picker (web\n"
)
LIST_ACCESS_COMMENT_NEW = (
    " * signal behind the lock the assignee picker draws (web\n"
)

PICKER_LOCK_COMMENT = (
    "          {/* Restricted agents carry web's lock (assignee-picker.tsx). It sits\n"
)
PICKER_LOCK_COMMENT_NEW = (
    "          {/* Restricted agents carry web's lock (assignee-picker.tsx).\n"
    "              The row gates it with:\n"
    '              {item.kind === "agent" && isRestrictedAgent(item.agent) ? (\n'
)

PICKER_TAG_COMMENT = (
    "              pattern used throughout iOS Settings — type tag in lighter font on\n"
)
PICKER_TAG_COMMENT_NEW = (
    "              pattern used throughout iOS Settings — the legacy `.visibility`\n"
    "              field is deliberately not consulted here — type tag in lighter font on\n"
)

# ── real `it(...)` strings, character for character ─────────────────────────

# logic
L_OWNER_ONLY = "marks owner-only agents restricted"
L_MEMBER_SCOPED = "marks member-scoped agents restricted"
L_WORKSPACE = "leaves workspace-wide agents unrestricted"
L_LEGACY = "ignores the legacy visibility field"

# wiring
W_IMPORT = "derives restricted-ness from the shared access-scope helper"
W_GATE = "gates the lock on that helper, on agent rows only"
W_ICON = "renders the lock icon"
W_A11Y = "keeps the lock out of the row's accessible name"
W_NO_LEGACY = "never reads the legacy visibility field"

ALL_LOGIC = [L_OWNER_ONLY, L_MEMBER_SCOPED, L_WORKSPACE, L_LEGACY]
ALL_WIRING = [W_IMPORT, W_GATE, W_ICON, W_A11Y, W_NO_LEGACY]
ALL_GUARDS = ALL_LOGIC + ALL_WIRING

# (label, [(file, old, new), ...], [tests that must fail], must contain)
CASES = [
    (
        "1 the predicate inverts (the round's own defect)",
        [(LIST_ACCESS, RESTRICTED_BODY, RESTRICTED_INVERTED)],
        [L_OWNER_ONLY, L_WORKSPACE],
        "expected false to be true",
    ),
    (
        "2 the predicate stops treating member-scoped grants as restricted",
        [(LIST_ACCESS, RESTRICTED_BODY, RESTRICTED_MEMBER_BLIND)],
        [L_MEMBER_SCOPED, L_OWNER_ONLY],
        "expected false to be true",
    ),
    (
        "3 the predicate reads the legacy visibility field",
        [(LIST_ACCESS, RESTRICTED_BODY, RESTRICTED_LEGACY)],
        [L_LEGACY],
        "expected false to be true",
    ),
    (
        "4 the picker stops rendering the lock at all",
        [(PICKER_BODY, LOCK_BLOCK, "")],
        [W_GATE, W_ICON, W_A11Y],
        "lock-closed-outline",
    ),
    (
        "5 the picker hardwires the lock on instead of gating it",
        [(PICKER_BODY, GATE, GATE_HARDWIRED)],
        [W_GATE],
        'item\\.kind === "agent" && isRestrictedAgent\\(item\\.agent\\)',
    ),
    (
        "6 the lock drops its screen-reader exclusion",
        [(PICKER_BODY, A11Y_PROP, A11Y_PROP_OFF)],
        [W_A11Y],
        "accessibilityElementsHidden",
    ),
    (
        "7 the picker mirrors the predicate locally and reads the legacy field",
        [
            (PICKER_BODY, SHARED_IMPORT, LOCAL_MIRROR),
        ],
        [W_IMPORT, W_NO_LEGACY],
        ".visibility",
    ),
]

GREEN_CASES = [
    (
        "G1 a comment reworded in agent-list-access.ts leaves every guard alone",
        [(LIST_ACCESS, LIST_ACCESS_COMMENT, LIST_ACCESS_COMMENT_NEW)],
        ALL_GUARDS,
    ),
    (
        "G2 a comment QUOTING the gate call leaves every guard alone",
        [(PICKER_BODY, PICKER_LOCK_COMMENT, PICKER_LOCK_COMMENT_NEW)],
        ALL_GUARDS,
    ),
    (
        "G3 a comment mentioning .visibility leaves the legacy guard alone",
        [(PICKER_BODY, PICKER_TAG_COMMENT, PICKER_TAG_COMMENT_NEW)],
        ALL_GUARDS,
    ),
]


def vitest(suites) -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", *suites, "--reporter=verbose"],
        cwd=MOBILE, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def all_output() -> str:
    return vitest(MOBILE_SUITES)


def red(out: str, name: str) -> bool:
    return any(name in line and ("×" in line or "✗" in line) for line in out.splitlines())


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def suites_green(out: str) -> bool:
    """Read the runner's own summary line, not the raw text.

    Substring-scanning the whole output for " failed" is wrong here: these
    guards read component sources, and a failing assertion prints the whole
    file body, which contains the word "failed" in the injected text. Parse
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
PRISTINE = {path: path.read_text(encoding="utf-8") for path in (LIST_ACCESS, PICKER_BODY)}


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
    if must_contain and must_contain not in ANSI.sub("", out):
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
out = vitest(MOBILE_SUITES)
ok = suites_green(out)
print(f"{'OK  ' if ok else 'FAIL'} {' + '.join(MOBILE_SUITES)}")
if not ok:
    for line in ANSI.sub("", out).splitlines():
        if "×" in line or "FAIL " in line or "Test Files" in line:
            print(f"      {line.strip()}")
    failures.append(f"guarded suites did not return to green: {MOBILE_SUITES}")

for path, before in PRISTINE.items():
    if path.read_text(encoding="utf-8") != before:
        failures.append(f"{path} left modified after restore")

if failures:
    print("\nFAILURES:")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)

print("\nall iter160 guards falsified")
