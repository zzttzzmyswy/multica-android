#!/usr/bin/env python3
"""Falsify iteration 155's guard changes: inject one defect per rule, confirm the
guard actually fails on it, then restore.

The 155 round adds no product copy either. It closes two holes the 154 round left
in the measurement machinery, and both are the same shape — a number that reads
like evidence and is not:

  * **Three `converged` claims still measured the whole locale.** 154 pinned the
    size of a *derived* scope on every claim that had one and left `フォルダ`
    (ja) and the two zh bracket claims whole-bundle, because a locale grows for
    reasons that have nothing to do with the claim. That kept the defect 154 had
    just fixed for the other five: a key added carrying the term moves the count
    with nothing folding, and the claim reports it as *"either the convergence
    was partial or the tally was wrong"* — naming the one cause it is not. All
    three now measure the keys that carry the term at all, in either form, and
    pin that set's size. Narrowing moves no count: a key carrying neither form
    contributes zero to either pattern.
  * **A `scopeSize` pin under an explicit `keys` list asserted nothing.** The
    scope is the list, so its size is `keys.length` — a literal, not a
    measurement — and no bundle edit can move it. `verify` now refuses the pair
    the way `scoped` refuses two narrowings.

Two smaller things came out of the round's sweep and are covered below: the
offender-list helper in `ja-ko-notation.test.ts` called `.test()` on patterns
that carry `g`, the trap `tally.ts` documents and normalises away everywhere
else; and `parity.test.ts` still carried its own copies of `flattenKeys` and the
namespace list that 154 had lifted into `tally.ts`.

The 151–154 lessons are applied literally:

  * The `it(...)` string a case names must match the suite's real test name
    character for character, and the injection anchor must be unique in the
    target file. The harness reports both as MISS with the count, rather than as
    a silent "the guard did not fire".
  * **The anchor has to change the thing being counted.**
  * A case may name a message the failure has to carry, and one it must not.
    Without that, "the guard went red" cannot tell the fix from the bug it fixes.
  * **A case may name more than one test that has to go red** — the `keys` pin is
    refused on the primary and on a rival by one check, and both assertions are
    load-bearing.

Rules covered:

candidate 1 — the narrowed scope, and the message it produces
  1.  the `フォルダ` scope pin set one key too low — the claim must report the
      scope, not the arithmetic.
  2.  the views bracket pin set one key too low — the same, on the other bundle.
  3.  **the pair that is the round's whole point.** A key carrying `フォルダ` is
      added to ja with the narrowing in place: the failure must carry the scope
      message and must not carry the arithmetic one.
  4.  the same key with the narrowing reverted to what 154 left: the failure must
      carry the arithmetic message and must not carry the scope one. This is the
      defect the round removes, pinned so a later round cannot quietly undo it.

candidate 2 — the pin that cannot fail
  5.  the `keys` check removed, so a pin that no bundle edit can move is accepted
      and measured. Both new assertions must go red.

the sweep — the `g`-flag trap and the dedupe
  6.  two ja keys carrying `サーバ` (no `ー`) added, matcher intact: the offender
      list must name both.
  7.  the same two keys with `keysMatching` reverted to `pattern.test(value)`: the
      guard still goes red, but on one offender — the second is skipped because
      the global pattern's `lastIndex` has already advanced past its match. The
      failure must not name it. This is the whole reason `valueMatcher` exists.

Green cases (must stay green — these are the rules' boundaries, not their targets):

G1. A key added to ja carrying no `フォルダ` leaves the claim alone: the scope is
    the keys that carry the term, so an unrelated string does not move it. This is
    the boundary that stopped 154 pinning the whole locale, and it still holds.
G2. A key added to the views zh bundle carrying no bracket pair leaves the bracket
    claim alone, for the same reason.

Run from the repo root: python3 scripts/falsify-iter155-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages/views/locales"

TALLY_TEST = "locales/tally.test.ts"
NOTATION = "locales/ja-ko-notation.test.ts"
ZH_TYPO = "locales/zh-typography.test.ts"

TALLY_FILE = LOCALES / "tally.ts"
NOTATION_FILE = LOCALES / "ja-ko-notation.test.ts"
ZH_TYPO_FILE = LOCALES / "zh-typography.test.ts"
JA_PROJECTS = LOCALES / "ja/projects.json"
JA_SKILLS = LOCALES / "ja/skills.json"
ZH_SETTINGS = LOCALES / "zh-Hans/settings.json"

# Exact source lines, kept as literals so the anchors are exact and unique.
KEYS_PIN_CHECK = "    if (measure.scopeSize === undefined || measure.keys === undefined) continue;"
KEYS_PIN_SKIP = "    if (true) continue;"

FOLDER_PIN = (
    "    primary: { keysFrom: folderKeys, pattern: /フォルダ(?!ー)/g, expected: 8, scopeSize: 8 },\n"
    "    rivals: [{ keysFrom: folderKeys, pattern: /フォルダー/g, expected: 1, scopeSize: 8 }],"
)
FOLDER_UNPINNED = (
    "    primary: { pattern: /フォルダ(?!ー)/g, expected: 8 },\n"
    "    rivals: [{ pattern: /フォルダー/g, expected: 1 }],"
)
FOLDER_PIN_ONE_LOW = FOLDER_PIN.replace("scopeSize: 8 }", "scopeSize: 7 }")

BRACKET_VIEWS_PIN = "      expected: 70,\n      scopeSize: 74,"
BRACKET_VIEWS_PIN_ONE_LOW = "      expected: 70,\n      scopeSize: 73,"

MATCHER = "  const matches = valueMatcher(pattern);"
MATCHER_UNSAFE = "  const matches = (value: string) => pattern.test(value);"

# A ja key that carries neither フォルダ nor any katakana, so it moves nothing the
# notation suite measures.
FOLDER_ANCHOR = '    "mode_add": "フォルダを追加",'
FOLDER_PROBE = FOLDER_ANCHOR + '\n    "iter155_probe": "新しいフォルダを開く",'
PLAIN_PROBE = FOLDER_ANCHOR + '\n    "iter155_probe": "設定を開く",'

# Two ja keys carrying `サーバ` with no long-vowel mark, so `/サーバ(?!ー)/g`
# matches both. Adjacent in the file, so adjacent in the loaded bundle.
SERVERS_ANCHOR = '        "is_directory": "同名のフォルダが既に存在します",'
SERVERS_PROBE = (
    SERVERS_ANCHOR
    + '\n        "iter155_probe_a": "サーバの設定",'
    + '\n        "iter155_probe_b": "サーバを追加",'
)

ZH_ANCHOR = '      "browser_suffix": "（浏览器）",'
ZH_PROBE = ZH_ANCHOR + '\n      "iter155_probe": "打开设置面板",'

FOLDER_TEST = "re-derives the pre-convergence counts the フォルダ line was drawn on"
BRACKET_TEST = "re-derives the pre-convergence counts the rule was derived from"
SERVERS_TEST = "never writes a rival spelling of サーバー"

SCOPE_MESSAGE = "moves the count without folding anything"
ARITHMETIC_MESSAGE = "either the convergence was partial or the tally was wrong"

# (label, suite, [(file, old, new), ...], [tests that must fail], must contain, must not contain)
CASES = [
    (
        "candidate 1: the フォルダ pin one key too low reports the scope",
        NOTATION,
        [(NOTATION_FILE, FOLDER_PIN, FOLDER_PIN_ONE_LOW)],
        [FOLDER_TEST],
        "the scope holds 8 keys where the before-counts were measured over 7",
        ARITHMETIC_MESSAGE,
    ),
    (
        "candidate 1: the views bracket pin one key too low reports the scope",
        ZH_TYPO,
        [(ZH_TYPO_FILE, BRACKET_VIEWS_PIN, BRACKET_VIEWS_PIN_ONE_LOW)],
        [BRACKET_TEST],
        "the scope holds 74 keys where the before-counts were measured over 73",
        ARITHMETIC_MESSAGE,
    ),
    (
        "candidate 1: a new ja key carrying フォルダ reports the scope, not the arithmetic",
        NOTATION,
        [(JA_PROJECTS, FOLDER_ANCHOR, FOLDER_PROBE)],
        [FOLDER_TEST],
        SCOPE_MESSAGE,
        ARITHMETIC_MESSAGE,
    ),
    (
        "candidate 1: the same key against the unpinned claim 154 left reports the arithmetic",
        NOTATION,
        [
            (NOTATION_FILE, FOLDER_PIN, FOLDER_UNPINNED),
            (JA_PROJECTS, FOLDER_ANCHOR, FOLDER_PROBE),
        ],
        [FOLDER_TEST],
        ARITHMETIC_MESSAGE,
        SCOPE_MESSAGE,
    ),
    (
        "candidate 2: dropping the `keys` check accepts a pin that cannot fail",
        TALLY_TEST,
        [(TALLY_FILE, KEYS_PIN_CHECK, KEYS_PIN_SKIP)],
        [
            "refuses a scope pin on a measure narrowed by `keys`",
            "refuses a `keys` scope pin on a rival too",
        ],
        None,
        None,
    ),
    (
        "sweep: two ja keys carrying サーバ are both named by the offender list",
        NOTATION,
        [(JA_SKILLS, SERVERS_ANCHOR, SERVERS_PROBE)],
        [SERVERS_TEST],
        "iter155_probe_b",
        None,
    ),
    (
        "sweep: with `.test()` on the global pattern the second offender is skipped",
        NOTATION,
        [
            (JA_SKILLS, SERVERS_ANCHOR, SERVERS_PROBE),
            (NOTATION_FILE, MATCHER, MATCHER_UNSAFE),
        ],
        [SERVERS_TEST],
        "iter155_probe_a",
        "iter155_probe_b",
    ),
]

GREEN_CASES = [
    (
        "G1 a key carrying no フォルダ leaves the claim alone",
        NOTATION,
        [(JA_PROJECTS, FOLDER_ANCHOR, PLAIN_PROBE)],
        FOLDER_TEST,
    ),
    (
        "G2 a key carrying no bracket pair leaves the bracket claim alone",
        ZH_TYPO,
        [(ZH_SETTINGS, ZH_ANCHOR, ZH_PROBE)],
        BRACKET_TEST,
    ),
]

SUITES = [TALLY_TEST, NOTATION, ZH_TYPO]


def vitest(suite: str) -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", suite, "--reporter=verbose"],
        cwd=ROOT / "packages/views", capture_output=True, text=True,
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

for label, suite, injections, must_fail, must_contain, must_not_contain in CASES:
    try:
        originals = inject(injections)
    except ValueError as error:
        failures.append(f"{label}: {error}")
        print(f"MISS {label} ({error})")
        continue
    try:
        out = vitest(suite)
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

for label, suite, injections, must_stay_green in GREEN_CASES:
    try:
        originals = inject(injections)
    except ValueError as error:
        failures.append(f"{label}: {error}")
        print(f"MISS {label} ({error})")
        continue
    try:
        out = vitest(suite)
    finally:
        restore(originals)

    if red(out, must_stay_green):
        failures.append(f"{label}: false positive — {must_stay_green!r} went red")
        print(f"FAIL {label}")
        continue
    print(f"OK   {label}")

print("\n-- restored state --")
for suite in SUITES:
    out = vitest(suite)
    ok = "failed" not in out.split("Test Files")[-1].split("\n")[0]
    print(f"{'OK  ' if ok else 'FAIL'} {suite}")
    if not ok:
        failures.append(f"{suite} did not return to green after restore")

result = subprocess.run(
    ["npx", "tsc", "--noEmit"], cwd=ROOT / "packages/views", capture_output=True, text=True,
)
ok = "error TS" not in result.stdout + result.stderr
print(f"{'OK  ' if ok else 'FAIL'} packages/views tsc --noEmit")
if not ok:
    failures.append("packages/views tsc not clean after restore")

print()
if failures:
    print(f"FAILED ({len(failures)}):")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)
print("all injections caught, all boundary cases green, workspace restored.")
