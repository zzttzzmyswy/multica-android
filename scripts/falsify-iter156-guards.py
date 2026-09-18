#!/usr/bin/env python3
"""Falsify iteration 156's guard: inject the defect the round fixes, confirm the
guard actually fails on it, then restore.

The 156 round changes what a user sees for the first time in fifteen rounds.
The About page's "build number" row has always rendered "—" on Android, because
it read `Constants.platform.android.versionCode` — and expo-constants
hard-codes Android's platform payload to an empty map
(`ConstantsService.kt`: `"platform" to mapOf("android" to emptyMap())`). Its own
type marks that field deprecated in favour of `expo-application`, so the row was
reading a key that is never there. The versionCode *is* available, on the
embedded app config — the same object the version row above it already reads
successfully on device.

The fix has two halves and both need a guard, because either one alone leaves
the row broken while the tests stay green:

  * `lib/app-identity.ts` resolves the build number from the embedded config.
  * `about.tsx` actually calls it. A pure-function test cannot see a revert of
    the screen, so the suite also asserts on the screen's source: it must call
    the resolvers and must not read the empty Android payload.

The 151–155 lessons are applied literally:

  * The `it(...)` string a case names must match the suite's real test name
    character for character, and the injection anchor must be unique in the
    target file. The harness reports both as MISS with the count, rather than as
    a silent "the guard did not fire".
  * **The anchor has to change the thing being asserted.**
  * **A case may name more than one test that has to go red** — reverting the
    screen reddens both wiring assertions, and both are load-bearing.
  * A case may name a message the failure has to carry, and one it must not.

Rules covered:

the row itself
  1.  the resolver reverted to the empty Android platform payload — the very
      defect of the round. The Android assertion must go red, and the failure
      must show the resolver produced "—" where "584" was expected.
  2.  the screen reverted to the inline platform read with the resolver intact.
      Both wiring assertions must go red: the call-site one and the
      forbidden-payload one. Neither alone would have caught it.

the surrounding guards
  3.  the iOS branch deleted — iOS would fall back to "—" even though
      expo-constants does populate `platform.ios.buildNumber` natively.
  4.  the blank-version guard loosened to a bare `typeof` check — the version
      row would render a bare "v" for an empty string instead of "0.0.0".
  5.  the Android null guard loosened from `typeof … === "number"` to
      `… !== undefined` — an explicit `null` versionCode would render the
      literal string "null".

Green cases (must stay green — the guard is content-specific, not churn-specific):

G1. A comment reworded in `about.tsx` leaves both wiring assertions green: they
    assert on the identity reads, not on "the file was touched".
G2. A comment reworded in `lib/app-identity.ts` leaves every guard green.

Run from the repo root: python3 scripts/falsify-iter156-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps/mobile"

SUITE = "lib/app-identity.test.ts"
IDENTITY_FILE = MOBILE / "lib/app-identity.ts"
ABOUT_FILE = MOBILE / "app/(app)/[workspace]/more/about.tsx"

# Exact source lines, kept as literals so the anchors are exact and unique.
ANDROID_READ = (
    "  const androidVersionCode = source.expoConfig?.android?.versionCode;\n"
    '  if (typeof androidVersionCode === "number") return `${androidVersionCode}`;'
)
ANDROID_READ_EMPTY_PAYLOAD = (
    "  const androidVersionCode = source.platform?.android?.versionCode;\n"
    '  if (typeof androidVersionCode === "number") return `${androidVersionCode}`;'
)

IOS_BLOCK = (
    "  const iosBuildNumber = source.platform?.ios?.buildNumber;\n"
    '  if (typeof iosBuildNumber === "string" && iosBuildNumber.length > 0) {\n'
    "    return iosBuildNumber;\n"
    "  }\n\n"
)

VERSION_GUARD = (
    '  return typeof version === "string" && version.length > 0\n'
    "    ? version\n"
    "    : UNKNOWN_APP_VERSION;"
)
VERSION_GUARD_LOOSE = (
    '  return typeof version === "string"\n'
    "    ? version\n"
    "    : UNKNOWN_APP_VERSION;"
)

NULL_GUARD = '  if (typeof androidVersionCode === "number") return `${androidVersionCode}`;'
NULL_GUARD_LOOSE = "  if (androidVersionCode !== undefined) return `${androidVersionCode}`;"

WIRING = "  const buildNumber = resolveBuildNumber(Constants);"
WIRING_INLINE = "  const buildNumber = Constants.platform?.android?.versionCode;"

ABOUT_COMMENT = " * About page — app identity"
ABOUT_COMMENT_NEW = " * About screen — app identity"
IDENTITY_COMMENT = " * Kept as pure functions over an injected source so the Node vitest lane can"
IDENTITY_COMMENT_NEW = " * Kept as pure functions over an injected source, so the Node vitest lane can"

# Real `it(...)` strings, character for character.
ANDROID_TEST = "reads Android's versionCode out of the embedded app config"
EMPTY_PAYLOAD_TEST = "cannot read Android's build number from the platform payload"
IOS_TEST = "reads iOS's build number from the native platform payload"
FALLBACK_TEST = "falls back to a placeholder when neither platform supplies one"
VERSION_FALLBACK_TEST = "falls back to a placeholder when the config is missing or blank"
WIRING_CALLSITE_TEST = "resolves both rows through the shared helpers"
WIRING_FORBIDDEN_TEST = (
    "no longer reads the build number from the empty Android platform payload"
)

# (label, [(file, old, new), ...], [tests that must fail], must contain, must not contain)
CASES = [
    (
        "the resolver reverted to the empty Android platform payload",
        [(IDENTITY_FILE, ANDROID_READ, ANDROID_READ_EMPTY_PAYLOAD)],
        [ANDROID_TEST],
        "expected '—' to be '584'",
        None,
    ),
    (
        "the screen reverted to the inline platform read, resolver intact",
        [(ABOUT_FILE, WIRING, WIRING_INLINE)],
        [WIRING_CALLSITE_TEST, WIRING_FORBIDDEN_TEST],
        "not to contain 'platform?.android?.versionCode'",
        None,
    ),
    (
        "the iOS branch deleted",
        [(IDENTITY_FILE, IOS_BLOCK, "")],
        [IOS_TEST],
        None,
        None,
    ),
    (
        "the blank-version guard loosened to a bare typeof check",
        [(IDENTITY_FILE, VERSION_GUARD, VERSION_GUARD_LOOSE)],
        [VERSION_FALLBACK_TEST],
        None,
        None,
    ),
    (
        "the Android null guard loosened to a !== undefined check",
        [(IDENTITY_FILE, NULL_GUARD, NULL_GUARD_LOOSE)],
        [FALLBACK_TEST],
        "expected 'null' to be '—'",
        None,
    ),
]

GREEN_CASES = [
    (
        "G1 a comment reworded in about.tsx leaves the wiring assertions alone",
        [(ABOUT_FILE, ABOUT_COMMENT, ABOUT_COMMENT_NEW)],
        [WIRING_CALLSITE_TEST, WIRING_FORBIDDEN_TEST],
    ),
    (
        "G2 a comment reworded in app-identity.ts leaves every guard alone",
        [(IDENTITY_FILE, IDENTITY_COMMENT, IDENTITY_COMMENT_NEW)],
        [ANDROID_TEST, EMPTY_PAYLOAD_TEST, IOS_TEST, FALLBACK_TEST],
    ),
]


def vitest(suite: str) -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", suite, "--reporter=verbose"],
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
        out = vitest(SUITE)
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
        out = vitest(SUITE)
    finally:
        restore(originals)

    went_red = [name for name in must_stay_green if red(out, name)]
    if went_red:
        failures.append(f"{label}: false positive — {went_red!r} went red")
        print(f"FAIL {label}")
        continue
    print(f"OK   {label}")

print("\n-- restored state --")
out = vitest(SUITE)
ok = " failed" not in out.split("Test Files")[-1]
print(f"{'OK  ' if ok else 'FAIL'} {SUITE}")
if not ok:
    failures.append(f"{SUITE} did not return to green after restore")

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
