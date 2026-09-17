#!/usr/bin/env python3
"""Falsify every rule this round added: inject one defect per rule, confirm the
guard actually fails on it, then restore. A guard that only ever passes proves
nothing — this is the round's counter-evidence.

The last case is the round's other half: the views guard's six
noUncheckedIndexedAccess errors. Its counter-evidence is the compiler, so the
case removes one `?? ""` and requires `tsc --noEmit` to go red again.

Run from the repo root: python3 scripts/falsify-iter143-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps/mobile"

VIEWS_TEST = "packages/views/locales/zh-glossary.test.ts"
MOBILE_TEST = "lib/i18n/zh-glossary.test.ts"

V_SQUADS = ROOT / "packages/views/locales/zh-Hans/squads.json"
V_MODALS = ROOT / "packages/views/locales/zh-Hans/modals.json"
V_GUARD = ROOT / "packages/views/locales/zh-glossary.test.ts"
M_ZH = MOBILE / "lib/i18n/locales/zh.json"

LEADER_RULE = "never spells the squad role in Latin"
VIEWS_SETTLED = "keeps the two squad strings this round settled"
MOBILE_SETTLED = "keeps the squad instructions blurb on the settled words"

# (label, file, old, new, cwd, test_file, test_name_that_must_fail)
CASES = [
    (
        "views: the squad role drifting back to Latin is caught",
        V_MODALS, '"leader_label": "队长智能体"', '"leader_label": "Leader 智能体"',
        ROOT, VIEWS_TEST, LEADER_RULE,
    ),
    (
        "views: the instructions blurb reverting to the leak is caught",
        V_SQUADS,
        "小队指引会在队长智能体处理分配给该小队的任务时注入到它的提示词中。",
        "小队指引会在 Leader 智能体处理分配给该小队的任务时注入到它的 prompt 中。",
        ROOT, VIEWS_TEST, VIEWS_SETTLED,
    ),
    (
        "views: the create-squad members hint reverting to the leak is caught",
        V_MODALS, '"members_hint": "队长可以委派子任务的成员。',
        '"members_hint": "Leader 可以委派子任务的成员。',
        ROOT, VIEWS_TEST, VIEWS_SETTLED,
    ),
    (
        "mobile: the squad role drifting back to Latin is caught",
        M_ZH, '"squads.new.leader": "队长"', '"squads.new.leader": "Leader"',
        MOBILE, MOBILE_TEST, LEADER_RULE,
    ),
    (
        "mobile: the instructions blurb reverting to the leak is caught",
        M_ZH,
        "小队指引会在队长智能体处理分配给该小队的任务时注入到它的提示词中。",
        "小队指引会在 Leader 智能体处理分配给该小队的任务时注入到它的 prompt 中。",
        MOBILE, MOBILE_TEST, MOBILE_SETTLED,
    ),
    (
        "mobile: 队长 dropped from the blurb while prompt is kept is caught",
        M_ZH,
        "小队指引会在队长智能体处理",
        "小队指引会在智能体处理",
        MOBILE, MOBILE_TEST, MOBILE_SETTLED,
    ),
]

# (label, file, old, new) — counter-evidence is the compiler, not a test.
TSC_CASES = [
    (
        "views guard: dropping the totality fallback is caught by tsc",
        V_GUARD,
        'const missing = named.filter(({ word }) => !(zh[key] ?? "").includes(word));',
        "const missing = named.filter(({ word }) => !zh[key].includes(word));",
    ),
]


def run(cwd: Path, args: list[str]) -> str:
    result = subprocess.run(
        ["npx", *args], cwd=cwd, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def vitest(cwd: Path, test_file: str) -> str:
    return run(cwd, ["vitest", "run", test_file, "--reporter=verbose"])


failures = []
for label, path, old, new, cwd, test_file, must_fail in CASES:
    src = path.read_text(encoding="utf-8")
    if src.count(old) < 1:
        failures.append(f"{label}: injection anchor not found in {path.name}")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = vitest(cwd, test_file)
    finally:
        path.write_text(src, encoding="utf-8")

    hit = any(
        must_fail in line and ("×" in line or "✗" in line)
        for line in out.splitlines()
    )
    if not hit:
        failures.append(f"{label}: guard stayed green (looked for {must_fail!r})")
    print(f"{'OK  ' if hit else 'MISS'} {label}")

for label, path, old, new in TSC_CASES:
    src = path.read_text(encoding="utf-8")
    if src.count(old) < 1:
        failures.append(f"{label}: injection anchor not found in {path.name}")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = run(ROOT / "packages/views", ["tsc", "--noEmit"])
    finally:
        path.write_text(src, encoding="utf-8")

    hit = "error TS" in out
    if not hit:
        failures.append(f"{label}: tsc stayed clean without the fallback")
    print(f"{'OK  ' if hit else 'MISS'} {label}")

# Restore-check: everything must be green again.
print("\n-- restored state --")
for cwd, test_file in [(ROOT, VIEWS_TEST), (MOBILE, MOBILE_TEST)]:
    out = vitest(cwd, test_file)
    ok = "failed" not in out.split("Test Files")[-1].split("\n")[0]
    print(f"{'OK  ' if ok else 'FAIL'} {test_file}")
    if not ok:
        failures.append(f"{test_file} did not return to green after restore")

out = run(ROOT / "packages/views", ["tsc", "--noEmit"])
ok = "error TS" not in out
print(f"{'OK  ' if ok else 'FAIL'} packages/views tsc --noEmit")
if not ok:
    failures.append("packages/views tsc did not return to clean after restore")

if failures:
    print("\nFAILURES:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("\nAll rules falsified, all bundles restored green.")
