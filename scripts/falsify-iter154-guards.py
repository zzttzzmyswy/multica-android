#!/usr/bin/env python3
"""Falsify iteration 154's guard changes: inject one defect per rule, confirm the
guard actually fails on it, then restore.

The 154 round adds no product copy. It changes four things, all of them about
numbers that could not be trusted:

  * `tally.ts` grows a `scopeSize` pin. A `converged` claim asserts arithmetic
    between a count taken today and a count taken in an earlier round, and that
    means something only if both were taken over the same key set. A `keysFrom`
    scope is derived from the *current* source bundle, so an English key added
    since the convergence grows the scope and moves the primary count with
    nothing folding — the same shape the arithmetic reports for a partial
    convergence, and reported as one until the size is pinned. The five claims
    in `ja-ko-concepts.test.ts` now pin it.
  * `scoped()` refuses a measure that names two of `keys`/`keysFrom`/`scope`.
    They select different sets, so the count would silently be taken over
    whichever branch ran first — the `g`-flag trap in another guise.
  * The combination behaviour around a narrowing (`unit` and `locale` under a
    prefix, `also` with `unmasked`, `keysFrom.masked` against `unmasked`) is
    asserted rather than left to branch order.
  * `scripts/probe-iter153-ko-notation.py` used `(?<!체크)리스트`, a whitelist of
    the one offender its author had thought of, and read 5 where the bundle
    holds 4 — `애널리스트` ("analyst") ends in `리스트`. The anchor is now the
    guard's own predicate.

The two 151 lessons and the two 152/153 ones are applied literally:

  * The `it(...)` string a case names must match the suite's real test name
    character for character, and the injection anchor must be unique in the
    target file. The harness reports both as MISS with the count, rather than as
    a silent "the guard did not fire".
  * **The anchor has to change the thing being counted.** The 152 round lost two
    cases to anchors that did not.
  * A case may name a message the failure has to carry, and one it must not.
    Without that, "the guard went red" cannot tell the fix from the bug it
    fixes: both the scope check and the arithmetic fail the same test, and only
    the message says which one ran.

Rules covered:

tally.ts — the scope pin
  1.  `reports a grown derived scope as the scope, not as a partial convergence`
      — the short-circuit removed, so the arithmetic runs and reports the
      misleading cause.
  2.  `re-derives the before-counts of the 146 round's convergences` — the
      daemon (ja) pin set one key too low.
  3.  the same test, with the *English* source growing a key that names the
      concept in all three locales. This is the round's own scenario: the fold
      is intact, nothing regressed, and the scope is the only thing that moved.
      The failure must carry the scope message and must not carry the
      arithmetic one.

tally.ts — the narrowing conflict
  4.  `refuses `keys` with `scope`` — the check removed, so a measure naming two
      key sets measures instead of throwing.

Green cases (must stay green — these are the rules' boundaries, not their targets):

G1. A key added to the English source that does **not** name the concept leaves
    the daemon scope the same size, so the convergence claim must not move.
G2. A key that names the concept only inside a `{{binding}}` is masked out of
    the derived set (`keysFrom.masked`), so it must not move either.
G3. `애널리스트` is not the word `리스트`. The ledger's `list (ko)` fact anchors
    on a Hangul boundary, so a key carrying the longer word must not move it —
    this is the probe defect the round fixed, pinned from the guard's side.

Run from the repo root: python3 scripts/falsify-iter154-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages/views/locales"

TALLY_TEST = "locales/tally.test.ts"
CONCEPTS = "locales/ja-ko-concepts.test.ts"
LEDGER = "locales/unsettled-ledger.test.ts"

TALLY_FILE = LOCALES / "tally.ts"
CONCEPTS_FILE = LOCALES / "ja-ko-concepts.test.ts"
EN_RUNTIMES = LOCALES / "en/runtimes.json"
JA_RUNTIMES = LOCALES / "ja/runtimes.json"
KO_RUNTIMES = LOCALES / "ko/runtimes.json"
KO_ONBOARDING = LOCALES / "ko/onboarding.json"

# Exact source lines, kept as literals so the anchors are exact and unique.
SHORT_CIRCUIT = (
    "    const changed = changedScopes(claim, rivals, ctx);\n"
    "    if (changed.length > 0) return changed;\n"
)
NARROWING_CHECK = "  if (named.length > 1) {"
DAEMON_JA = '    label: "daemon",\n    locale: "ja",\n    native: 28,\n    scopeSize: 33,'

EN_DAEMON_CLI = '    "fact_daemon_cli": "Daemon CLI",'
JA_DAEMON_CLI = '    "fact_daemon_cli": "デーモン CLI",'
KO_DAEMON_CLI = '    "fact_daemon_cli": "데몬 CLI",'
KO_ANALYST = '"research": "리서처 / 애널리스트"'

SCOPE_MESSAGE = "the scope holds 34 keys where the before-counts were measured over 33"
ARITHMETIC_MESSAGE = "the convergence was partial or the tally was wrong"

# (label, suite, [(file, old, new), ...], test that must fail, must contain, must not contain)
CASES = [
    (
        "tally.ts: dropping the scope short-circuit reports a grown scope as a partial convergence",
        TALLY_TEST,
        [(TALLY_FILE, SHORT_CIRCUIT, "")],
        "reports a grown derived scope as the scope, not as a partial convergence",
        "the scope holds 4 keys where the before-counts were measured over 3",
        None,
    ),
    (
        "tally.ts: dropping the narrowing check lets a two-key-set measure measure",
        TALLY_TEST,
        [(TALLY_FILE, NARROWING_CHECK, "  if (false) {")],
        "refuses `keys` with `scope`",
        None,
        None,
    ),
    (
        "ja-ko-concepts: a scope pin one key too low trips the convergence claim",
        CONCEPTS,
        [(CONCEPTS_FILE, DAEMON_JA, DAEMON_JA.replace("scopeSize: 33", "scopeSize: 32"))],
        "re-derives the before-counts of the 146 round's convergences",
        "the scope holds 33 keys where the before-counts were measured over 32",
        ARITHMETIC_MESSAGE,
    ),
    (
        "ja-ko-concepts: the English source growing a key trips the scope, not the arithmetic",
        CONCEPTS,
        [
            (EN_RUNTIMES, EN_DAEMON_CLI, EN_DAEMON_CLI + '\n    "iter154_probe": "restart the daemon",'),
            (JA_RUNTIMES, JA_DAEMON_CLI, JA_DAEMON_CLI + '\n    "iter154_probe": "デーモンを再起動",'),
            (KO_RUNTIMES, KO_DAEMON_CLI, KO_DAEMON_CLI + '\n    "iter154_probe": "데몬을 재시작",'),
        ],
        "re-derives the before-counts of the 146 round's convergences",
        SCOPE_MESSAGE,
        ARITHMETIC_MESSAGE,
    ),
]

GREEN_CASES = [
    (
        "G1 a key that does not name the concept leaves the derived scope alone",
        CONCEPTS,
        [(EN_RUNTIMES, EN_DAEMON_CLI, EN_DAEMON_CLI + '\n    "iter154_probe": "restart the service",')],
        "re-derives the before-counts of the 146 round's convergences",
    ),
    (
        "G2 a concept named only inside a binding is masked out of the scope",
        CONCEPTS,
        [(EN_RUNTIMES, EN_DAEMON_CLI, EN_DAEMON_CLI + '\n    "iter154_probe": "the {{daemon}} runner",')],
        "re-derives the before-counts of the 146 round's convergences",
    ),
    (
        "G3 애널리스트 is not the word 리스트",
        LEDGER,
        [(KO_ONBOARDING, KO_ANALYST, KO_ANALYST + ',\n      "iter154_probe": "애널리스트"')],
        "keeps every number in list (ko)'s why re-derivable",
    ),
]

SUITES = [TALLY_TEST, CONCEPTS, LEDGER]


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

    if not red(out, must_fail):
        failures.append(f"{label}: guard stayed green (looked for {must_fail!r})")
        print(f"MISS {label}")
        continue
    if must_contain and must_contain not in out:
        failures.append(f"{label}: failure did not carry {must_contain!r}")
        print(f"MISS {label} (message absent)")
        continue
    if must_not_contain and must_not_contain in out:
        failures.append(f"{label}: failure still carried {must_not_contain!r}")
        print(f"MISS {label} (old message present)")
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
