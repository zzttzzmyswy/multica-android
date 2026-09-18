#!/usr/bin/env python3
"""Falsify every rule this round added: inject one defect per rule, confirm the
guard actually fails on it, then restore. A guard that only ever passes proves
nothing — this is the round's counter-evidence.

Two rules are under test.

1. `field_prompt`: the bare English source word `Prompt` is a field label, and
   the bundle settles it as 提示词. The cases attack it from both sides — the
   label drifting back to Latin, and the compound `System prompt` being
   over-translated — plus the derivation itself, by editing the *English* source
   and requiring the guard to notice that its premise moved.

2. `skill`: the voice guide keeps it lowercase English, and both bundles had
   drifted from that (mobile on 62 keys, views on 8). Each side gets the same
   pair of cases — the Chinese word creeping back, and the Latin token being
   dropped.

Run from the repo root: python3 scripts/falsify-iter144-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps/mobile"

VIEWS_TEST = "packages/views/locales/zh-glossary.test.ts"
MOBILE_TEST = "lib/i18n/zh-glossary.test.ts"

V_AUTOPILOTS = ROOT / "packages/views/locales/zh-Hans/autopilots.json"
V_AGENTS = ROOT / "packages/views/locales/zh-Hans/agents.json"
V_EN_SETTINGS = ROOT / "packages/views/locales/en/settings.json"
V_SKILLS = ROOT / "packages/views/locales/zh-Hans/skills.json"
M_ZH = MOBILE / "lib/i18n/locales/zh.json"

VIEWS_RULE = "renders the bare source word `Prompt` as 提示词"
VIEWS_SET = "still finds that label on more than one surface"
VIEWS_COMPOUND = "leaves the compound `System prompt` in Latin"
MOBILE_RULE = "renders every key sourced from the bare word `Prompt` as 提示词"
MOBILE_NO_LATIN = "leaves no Latin `Prompt` anywhere in the bundle"
SKILL_TOKEN = "keeps the Latin token wherever the English source names a skill"
SKILL_CHINESE = "never renders the concept with a Chinese word"

# (label, file, old, new, cwd, test_file, test_name_that_must_fail)
CASES = [
    (
        "views: the autopilot label drifting back to Latin is caught",
        V_AUTOPILOTS, '"field_prompt": "提示词"', '"field_prompt": "Prompt"',
        ROOT, VIEWS_TEST, VIEWS_RULE,
    ),
    (
        "views: over-translating the compound `System prompt` is caught",
        V_AGENTS, '"system_prompt_label": "System Prompt"',
        '"system_prompt_label": "系统提示词"',
        ROOT, VIEWS_TEST, VIEWS_COMPOUND,
    ),
    (
        "views: the guard reads the English source, not a fixed key list",
        V_EN_SETTINGS, '"field_prompt": "Prompt"', '"field_prompt": "Prompt text"',
        ROOT, VIEWS_TEST, VIEWS_SET,
    ),
    (
        "mobile: the settled word drifting back to Latin is caught",
        M_ZH, '"autopilots.detail.fieldPrompt": "提示词"',
        '"autopilots.detail.fieldPrompt": "Prompt"',
        MOBILE, MOBILE_TEST, MOBILE_RULE,
    ),
    (
        "mobile: a competing Chinese word for the label is caught",
        M_ZH, '"quickActions.fieldPrompt": "提示词"', '"quickActions.fieldPrompt": "提示"',
        MOBILE, MOBILE_TEST, MOBILE_RULE,
    ),
    (
        "mobile: a stray Latin `Prompt` on any other key is caught",
        M_ZH, '"quickActions.promptHint": "原样发送。智能体本来就能看到这个任务。"',
        '"quickActions.promptHint": "原样发送。智能体本来就能看到这个任务。Prompt"',
        MOBILE, MOBILE_TEST, MOBILE_NO_LATIN,
    ),
    (
        "views: 技能 creeping back into the detail page is caught",
        V_SKILLS, '"aria": "skill 分区"', '"aria": "技能分区"',
        ROOT, VIEWS_TEST, SKILL_CHINESE,
    ),
    (
        "views: a key dropping the Latin token is caught",
        V_SKILLS, '"list_aria": "skill 文件"', '"list_aria": "文件"',
        ROOT, VIEWS_TEST, SKILL_TOKEN,
    ),
    (
        "mobile: 技能 creeping back is caught",
        M_ZH, '"skills.delete": "删除 skill"', '"skills.delete": "删除技能"',
        MOBILE, MOBILE_TEST, SKILL_CHINESE,
    ),
    (
        "mobile: a key dropping the Latin token is caught",
        M_ZH, '"skills.emptyTitle": "还没有 skill"', '"skills.emptyTitle": "还没有"',
        MOBILE, MOBILE_TEST, SKILL_TOKEN,
    ),
]


def run(cwd: Path, args: list[str]) -> str:
    result = subprocess.run(["npx", *args], cwd=cwd, capture_output=True, text=True)
    return result.stdout + result.stderr


def vitest(cwd: Path, test_file: str) -> str:
    return run(cwd, ["vitest", "run", test_file, "--reporter=verbose"])


failures = []
for label, path, old, new, cwd, test_file, must_fail in CASES:
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{label}: injection anchor not unique in {path.name} ({src.count(old)})")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = vitest(cwd, test_file)
    finally:
        path.write_text(src, encoding="utf-8")

    hit = any(must_fail in line and ("×" in line or "✗" in line) for line in out.splitlines())
    if not hit:
        failures.append(f"{label}: guard stayed green (looked for {must_fail!r})")
    print(f"{'OK  ' if hit else 'MISS'} {label}")

# Restore-check: everything must be green again.
print("\n-- restored state --")
for cwd, test_file in [(ROOT, VIEWS_TEST), (MOBILE, MOBILE_TEST)]:
    out = vitest(cwd, test_file)
    ok = "failed" not in out.split("Test Files")[-1].split("\n")[0]
    print(f"{'OK  ' if ok else 'FAIL'} {test_file}")
    if not ok:
        failures.append(f"{test_file} did not return to green after restore")

for pkg in ("packages/views", "apps/mobile"):
    out = run(ROOT / pkg, ["tsc", "--noEmit"])
    ok = "error TS" not in out
    print(f"{'OK  ' if ok else 'FAIL'} {pkg} tsc --noEmit")
    if not ok:
        failures.append(f"{pkg} tsc not clean after restore")

if failures:
    print("\nFAILURES:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("\nAll rules falsified, all bundles restored green.")
