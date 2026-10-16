#!/usr/bin/env python3
"""Mutation-test iteration 251's "the update check can read a namespaced tag"
fix (apps/mobile).

The defect was a silent one: `parseVersionSegments` stripped exactly one
leading `v` and rejected any segment that was not all digits, so the Android
channel's `mobile-v0.6.83` parsed to `null`; `compareVersions` mapped that
`null` onto `0`, `isNewer` onto `false`, and the About page rendered "当前已是
最新版本" over a tag that plainly disagreed with it. The channel was dead for
~40 releases and the only symptom was a confident claim that was wrong.

That shape is what these mutations attack. A guard can pass for the wrong
reason here in several distinct ways — parse the tag but not gate on it, fix
the parse but keep rendering the raw tag, keep the doubled prefix, or leave
`hasUpdate` unreachable — so each mutation injects ONE such half-defect and
asserts the suite turns RED. The restore is then asserted GREEN. A guard that
cannot be made to fail is not a guard (the repo's standing discipline,
`scripts/falsify-*.py`).

Shapes, mirroring the issue's acceptance criteria:

   1. the pre-fix parser: strip one `v`, reject everything non-numeric
   2. the unreadable case collapses back into "equal" (orderVersions -> null
      folded onto 0 by compareVersions)
   3. the namespaced marker is not optional: `mobile-0.6.83` (no `v`) fails
   4. the namespace match is anchored to the literal name `mobile-`
   5. `checkForUpdate` reports "up-to-date" when the tag is unreadable
   6. `displayVersion` strips only a leading `v` (the doubled-prefix bug)
   7. the About page keeps a raw tag in the template (re-introduces `vmobile-`)
   8. the About page treats `unreadable` as "no update", claiming up-to-date
   9. the badge probe counts `unreadable` as an update (false positive dot)

Run: python3 scripts/falsify-iter251-update-version-compare.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
APP_VERSION = APP / "lib" / "app-version.ts"
RELEASE_CHECK = APP / "lib" / "release-check.ts"
ABOUT = APP / "app" / "(app)" / "[workspace]" / "more" / "about.tsx"
STATE = APP / "lib" / "about-update-state.ts"

SUITE = [
    "lib/app-version.test.ts",
    "lib/release-check.test.ts",
    "lib/about-update-state.test.ts",
    "lib/i18n/about-keys.test.ts",
]

# The fixed parser body, verbatim, so mutation 1 restores the exact shape the
# iteration set out to kill rather than a paraphrase of it.
FIXED_PARSER = """  const namespaced = trimmed.match(
    /^(?:[A-Za-z][A-Za-z0-9]*(?:\\.[A-Za-z][A-Za-z0-9]*)*-)+[vV]?(\\d+(?:\\.\\d+)*)/,
  );
  // No namespace: allow the bare `v` marker in front of the digits.
  const bare = namespaced ? null : trimmed.match(/^[vV]?(\\d+(?:\\.\\d+)*)/);
  const core = namespaced?.[1] ?? bare?.[1];
  if (!core) return null;"""

PRE_FIX_PARSER = """  const bare = trimmed.replace(/^[vV]/, "");
  if (!bare) return null;
  const [core] = bare.split(/[-+]/);"""


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        ["npx", "--no-install", "vitest", "run", *SUITE],
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
        "1. the pre-fix parser: one leading v, non-numeric segments rejected",
        APP_VERSION,
        FIXED_PARSER,
        PRE_FIX_PARSER,
    ),
    (
        "2. the unreadable case collapses back into 'equal'",
        RELEASE_CHECK,
        """  const ordering = orderVersions(tagName, currentVersion);
  if (ordering === null) return "unreadable";
  return ordering > 0 ? "update-available" : "up-to-date";""",
        """  return compareVersions(tagName, currentVersion) > 0
    ? "update-available"
    : "up-to-date";""",
    ),
    (
        "3. the v marker is not optional: `mobile-0.6.83` no longer parses",
        APP_VERSION,
        "(?:[A-Za-z][A-Za-z0-9]*(?:\\.[A-Za-z][A-Za-z0-9]*)*-)+[vV]?(\\d+(?:\\.\\d+)*)",
        "(?:[A-Za-z][A-Za-z0-9]*(?:\\.[A-Za-z][A-Za-z0-9]*)*-)+[vV](\\d+(?:\\.\\d+)*)",
    ),
    (
        "4. the namespace is hard-coded to the literal `mobile-`",
        APP_VERSION,
        "/^(?:[A-Za-z][A-Za-z0-9]*(?:\\.[A-Za-z][A-Za-z0-9]*)*-)+[vV]?(\\d+(?:\\.\\d+)*)/",
        "/^mobile-[vV]?(\\d+(?:\\.\\d+)*)/",
    ),
    (
        "5. an unreadable tag is reported as up-to-date",
        RELEASE_CHECK,
        '  if (ordering === null) return "unreadable";\n',
        '  if (ordering === null) return "up-to-date";\n',
    ),
    (
        "6. displayVersion strips only a leading v (the doubled-prefix bug)",
        RELEASE_CHECK,
        """  const segments = parseVersionSegments(tagName);
  return segments ? segments.join(".") : tagName.trim();""",
        """  return tagName.trim().replace(/^v/i, "");""",
    ),
    (
        "7. the About page feeds the raw tag to the template (re-doubles the v)",
        ABOUT,
        '? t(UPDATE_STATE_KEYS[state], { version: latestVersion ?? "" })',
        '? t(UPDATE_STATE_KEYS[state], { version: release?.tag_name ?? "" })',
    ),
    (
        "8. the resolver folds 'unreadable' into 'up-to-date', claiming current",
        STATE,
        '  if (check === "unreadable") return "unreadable";\n',
        '  if (check === "unreadable") return "up-to-date";\n',
    ),
    (
        "9. the badge probe lights for an unreadable tag (false promise)",
        STATE,
        '  return check === "update-available";',
        '  return check !== "up-to-date";',
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
