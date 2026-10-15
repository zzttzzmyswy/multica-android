#!/usr/bin/env python3
"""Mutation-test iteration 247's runtime registration-failure surface (MYS-2175).

The defect is a WIRING gap, the easiest kind to half-fix and still look right:
`customRuntimeRegistrationFailure` was ported from web, is correct, and has
been unit-tested since it landed — and no product code called it. The visible
half (a red caption on the list row) can be made to appear while the row still
shows a health dot, still prints no reason, and still says nothing on the
machine page. Each mutation below injects ONE such half-defect and asserts the
suite turns RED; the restore is asserted GREEN. A guard that cannot be made to
fail is not a guard — the repo's standing discipline (`scripts/falsify-*.py`).

The four the acceptance criteria name:

   1. the failure branch is dropped from the list row
      -> the row falls through to derived health and says "recently lost"
   2. the failure branch is nested INSIDE the pending one
      -> dead code (a failure row is never pending), reads as still waiting
   3. the reason never reaches the row text
      -> "Registration error" with the daemon's explanation hidden
   4. the machine detail row never consumes the helper
      -> web's CliCell surface has no counterpart on the phone

The rest are the invariants the fix's own correctness rests on:

   5. the destructive tint is lost (label renders in muted grey)
   6. the health dot is left in place beside the alert glyph
   7. the reason is dropped from the accessibility label
   8. the pending-only row stops saying it is registering
   9. the machine page's health line loses the failure branch
  10. an en value is replaced by the zh string
  11. the key is dropped from the zh bundle

Run: python3 scripts/falsify-iter247-runtime-registration-error.py
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
LIST = APP / "app" / "(app)" / "[workspace]" / "more" / "runtimes.tsx"
MACHINE = (
    APP / "app" / "(app)" / "[workspace]" / "more" / "runtimes" / "machine"
    / "[machineId].tsx"
)
EN = APP / "lib" / "i18n" / "locales" / "en.json"
ZH = APP / "lib" / "i18n" / "locales" / "zh.json"

SUITE = [
    "lib/runtime-registration-error-wiring.test.ts",
    "lib/i18n/iter247-keys.test.ts",
    "lib/pending-runtime.test.ts",
    "lib/i18n/locale-completeness.test.ts",
]


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
        "1. the list row stops asking whether this runtime failed",
        LIST,
        "  const registrationFailure = customRuntimeRegistrationFailure(runtime);",
        "  const registrationFailure: string | null = null;\n"
        "  void customRuntimeRegistrationFailure;",
    ),
    (
        "2. the failure branch is nested inside the pending one",
        LIST,
        '            {registrationFailure ? (\n'
        '              <Ionicons name="alert-circle" size={12} color={destructive} />\n'
        '            ) : pending ? null : (',
        '            {pending ? (registrationFailure ? (\n'
        '              <Ionicons name="alert-circle" size={12} color={destructive} />\n'
        '            ) : null) : (',
    ),
    (
        "3. the daemon's reason never reaches the row text",
        LIST,
        "              {registrationFailure\n"
        "                ? ` · ${registrationFailure}`\n",
        "              {registrationFailure\n"
        "                ? ``\n",
    ),
    (
        "4. the machine detail row stops consuming the helper",
        MACHINE,
        "  const registrationFailure = customRuntimeRegistrationFailure(runtime);",
        "  const registrationFailure: string | null = null;\n"
        "  void customRuntimeRegistrationFailure;",
    ),
    (
        "5. the failure caption loses its destructive tint",
        LIST,
        '                registrationFailure\n'
        '                  ? "text-destructive"\n',
        '                registrationFailure\n'
        '                  ? "text-muted-foreground"\n',
    ),
    (
        "6. the health dot is left in place beside the alert glyph",
        MACHINE,
        "            {registrationFailure ? (\n"
        "              <Ionicons\n"
        '                name="alert-circle"',
        "            {false ? (\n"
        "              <Ionicons\n"
        '                name="alert-circle"',
    ),
    (
        "7. the reason is dropped from the accessibility label",
        LIST,
        "              accessibilityLabel={\n"
        "                registrationFailure\n"
        '                  ? `${t("runtimes.list.pending_health_error")} · ${registrationFailure}`\n'
        "                  : undefined\n"
        "              }",
        "              accessibilityLabel={undefined}",
    ),
    (
        "8. the pending-only row stops saying it is registering",
        LIST,
        '                  t("runtimes.list.pending_health")\n',
        '                  t("runtimes.list.pending_health_error")\n',
    ),
    (
        "9. the machine page's health line loses the failure branch",
        MACHINE,
        "  const healthLine = registrationFailure\n    ? [",
        "  const healthLine = false\n    ? [",
    ),
    (
        "10. an en value is replaced by the zh string",
        EN,
        '  "runtimes.list.pending_health_error": "Registration error",',
        '  "runtimes.list.pending_health_error": "注册错误",',
    ),
]


def drop_zh_key() -> None:
    """Mutation 10 needs a real JSON edit, not a string replace."""
    data = json.loads(ZH.read_text())
    data.pop("runtimes.list.pending_health_error")
    ZH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


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
        # The restore must itself be green, or the mutation's verdict is junk.
        restored_green, _ = run_suite()
        if not restored_green:
            print(f"[BAD]  {name}: restore did not return to GREEN")
            failures.append(name)

    # 11. the key is dropped from the zh bundle.
    name = "11. the key is dropped from the zh bundle"
    original_zh = ZH.read_text()
    try:
        drop_zh_key()
        mutated_green, _ = run_suite()
    finally:
        ZH.write_text(original_zh)
    if mutated_green:
        print(f"[MISS] {name}: suite stayed GREEN")
        failures.append(name)
    else:
        print(f"[OK]   {name}: turned RED")
    restored_green, _ = run_suite()
    if not restored_green:
        print(f"[BAD]  {name}: restore did not return to GREEN")
        failures.append(name)

    total = len(MUTATIONS) + 1
    print()
    if failures:
        print(f"{len(failures)}/{total} did not hold:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"all {total} mutations turned RED and restored GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
