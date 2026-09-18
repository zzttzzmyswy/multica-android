#!/usr/bin/env python3
"""Falsify iteration 153's guard changes: inject one defect per rule, confirm the
guard actually fails on it, then restore.

The 153 round adds no product copy — every change is to a guard, a ledger entry,
`tally.ts`, or the contract. It made seven convergences re-derivable that had
been prose since the round that performed them, tightened `tally.ts` so a
`converged` claim whose numbers cannot mean anything is rejected instead of
measured, gave `tally.ts` its own unit tests, added two ko ledger entries
(particle spacing after a Latin token, and 목록/리스트), and corrected one number
that had been wrong since the round that wrote it — the zh bracket bullet's
"25 times in views and 11 in mobile", which is 27 and 12.

The two 151 lessons are applied literally:

  * The `it(...)` string a case names must match the suite's real test name
    character for character, and the injection anchor must be unique in the
    target file. The harness reports both as MISS with the count, rather than as
    a silent "the guard did not fire".
  * **The anchor has to change the thing being counted.** The 152 round lost two
    cases to anchors that did not: one deleted a key that was not in the carried
    set, one removed one occurrence of a run rather than the last. Every anchor
    below was checked against the claim it is meant to move.

Rules covered:

zh-typography — the bracket convergence and the evidence against a content partition
  1.  `re-derives the pre-convergence counts the rule was derived from` — a
      full-width pair turned half-width, and a full-width pair deleted.
  2.  `re-derives the evidence that content kind separates nothing` — a
      non-Chinese pair rewritten to wrap Chinese, which is the number 151 wrote
      stale in the first place.

ja-ko-notation — the フォルダ convergence
  3.  `re-derives the pre-convergence counts the フォルダ line was drawn on` —
      the straggler coming back.

ja-ko-concepts — the 146 round's five convergences
  4.  `re-derives the before-counts of the 146 round's convergences` — a native
      word replaced by its Latin rival (ja daemon), and by the ko rival
      (ko member).

tally.ts — the converged branch's structural checks
  5.  `refuses a claim with no rivals to fold` — the check removed.
  6.  `refuses a rival counted in a different unit from the primary` — the unit
      check removed.
  7.  `refuses a rival read from a different locale from the primary` — the
      locale check removed.

ledger — the two new ko entries
  8.  `keeps every number in particle spacing after Latin (ko)'s why
      re-derivable` — an attached particle spaced.
  9.  `keeps the collision that blocks a clean partition for particle spacing
      after Latin (ko)` — the attached anchor spaced.
  10. `keeps every number in list (ko)'s why re-derivable` — 목록 → 리스트.

Green cases (must stay green — these are the rules' boundaries, not their targets):

G1. A full-width pair wrapping Latin is the rule's own territory, not a
    half-width violation.
G2. A **figure** spaced off its counter is the figure surface, which 150 pinned
    separately; the particle pattern requires a token with a Latin letter, so it
    must not fire on `45 초`.
G3. `애널리스트` ("analyst") ends in `리스트` but is not the word `리스트`. The
    list entry's boundary anchor exists for exactly this, and this is the
    `템플릿`/`플릿` false positive one file over.

Run from the repo root: python3 scripts/falsify-iter153-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages/views/locales"

ZH_TYPOGRAPHY = "locales/zh-typography.test.ts"
NOTATION = "locales/ja-ko-notation.test.ts"
CONCEPTS = "locales/ja-ko-concepts.test.ts"
LEDGER = "locales/unsettled-ledger.test.ts"
TALLY = "locales/tally.test.ts"
SUITES = [ZH_TYPOGRAPHY, NOTATION, CONCEPTS, LEDGER, TALLY]

TALLY_FILE = LOCALES / "tally.ts"
ZH_SETTINGS = LOCALES / "zh-Hans/settings.json"
JA_SKILLS = LOCALES / "ja/skills.json"
JA_RUNTIMES = LOCALES / "ja/runtimes.json"
KO_AGENTS = LOCALES / "ko/agents.json"
KO_SETTINGS = LOCALES / "ko/settings.json"
KO_SKILLS = LOCALES / "ko/skills.json"
KO_EDITOR = LOCALES / "ko/editor.json"
KO_ONBOARDING = LOCALES / "ko/onboarding.json"
KO_RUNTIMES = LOCALES / "ko/runtimes.json"

# Exact JSON lines, kept as literals so the anchors are exact and unique.
ZH_BROWSER = '"browser_suffix": "（浏览器）"'
ZH_BOT_TOKEN = '"byo_bot_token_label": "Bot token（xoxb-）"'
ZH_OPTIONAL = '"byo_appkey_label": "AppKey（client id）"'
JA_FOLDER = '"is_directory": "同名のフォルダが既に存在します"'
JA_DAEMON = '"hint": "通常は数秒かかります。デーモンがワークスペースに登録しています。"'
KO_MEMBERS_EMPTY = '"members_empty": "선택할 워크스페이스 멤버가 없습니다"'
KO_CLI = (
    '"description": "개인 액세스 토큰을 사용하면 CLI와 외부 연동이 내 계정으로 인증할 수 있습니다. '
    'multica login --token 으로 사용하거나 API 호출 시 Bearer 토큰으로 보낼 수 있습니다.",'
)
KO_SKILL_MD = '"reserved": "SKILL.md는 메인 파일용으로 예약되어 있습니다.",'
KO_LIST = '"list": "목록",'
KO_ANALYST = '"research": "리서처 / 애널리스트",'
KO_45S = '"description": "최근 45초 안에 하트비트를 받았습니다. 작업을 디스패치할 준비가 되었습니다."'

CONVERGED_CALL = '  if (when === "converged") checkConvergence(claim, rivals, ctx);\n'
UNIT_CHECK = "    if (rivalUnit !== unit) {"
LOCALE_CHECK = "    if (rivalLocale !== locale) {"

# (label, file to inject into, suite to run, old, new, test that must fail)
CASES = [
    (
        "zh: a full-width bracket pair turned half-width trips the bracket convergence",
        ZH_SETTINGS, ZH_TYPOGRAPHY,
        ZH_BROWSER,
        '"browser_suffix": "(浏览器)"',
        "re-derives the pre-convergence counts the rule was derived from",
    ),
    (
        "zh: deleting a full-width bracket pair trips the bracket convergence",
        ZH_SETTINGS, ZH_TYPOGRAPHY,
        ZH_OPTIONAL,
        '"byo_appkey_label": "AppKey client id"',
        "re-derives the pre-convergence counts the rule was derived from",
    ),
    (
        "zh: a non-Chinese pair rewritten to wrap Chinese trips the partition evidence",
        ZH_SETTINGS, ZH_TYPOGRAPHY,
        ZH_BOT_TOKEN,
        '"byo_bot_token_label": "Bot token（令牌）"',
        "re-derives the evidence that content kind separates nothing",
    ),
    (
        "ja: the フォルダー straggler coming back trips the フォルダ convergence",
        JA_SKILLS, NOTATION,
        JA_FOLDER,
        '"is_directory": "同名のフォルダーが既に存在します"',
        "re-derives the pre-convergence counts the フォルダ line was drawn on",
    ),
    (
        "ja: daemon reverting to Latin trips the 146 convergence claim",
        JA_RUNTIMES, CONCEPTS,
        JA_DAEMON,
        '"hint": "通常は数秒かかります。daemon がワークスペースに登録しています。"',
        "re-derives the before-counts of the 146 round's convergences",
    ),
    (
        "ko: member reverting to 구성원 trips the 146 convergence claim",
        KO_AGENTS, CONCEPTS,
        KO_MEMBERS_EMPTY,
        '"members_empty": "선택할 워크스페이스 구성원이 없습니다"',
        "re-derives the before-counts of the 146 round's convergences",
    ),
    (
        "tally.ts: dropping the converged shape check un-guards a vacuous claim",
        TALLY_FILE, TALLY,
        CONVERGED_CALL,
        "",
        "refuses a claim with no rivals to fold",
    ),
    (
        "tally.ts: dropping the unit check un-guards a mixed-unit convergence",
        TALLY_FILE, TALLY,
        UNIT_CHECK,
        "    if (false) {",
        "refuses a rival counted in a different unit from the primary",
    ),
    (
        "tally.ts: dropping the locale check un-guards a cross-locale convergence",
        TALLY_FILE, TALLY,
        LOCALE_CHECK,
        "    if (false) {",
        "refuses a rival read from a different locale from the primary",
    ),
    (
        "ko: spacing an attached particle trips the particle-spacing entry",
        KO_SETTINGS, LEDGER,
        KO_CLI,
        KO_CLI.replace("CLI와", "CLI 와"),
        "keeps every number in particle spacing after Latin (ko)'s why re-derivable",
    ),
    (
        "ko: spacing the attached anchor trips the particle-spacing collision",
        KO_SKILLS, LEDGER,
        KO_SKILL_MD,
        '"reserved": "SKILL.md 는 메인 파일용으로 예약되어 있습니다.",',
        "keeps the collision that blocks a clean partition for particle spacing after Latin (ko)",
    ),
    (
        "ko: 목록 becoming 리스트 trips the list entry",
        KO_EDITOR, LEDGER,
        KO_LIST,
        '"list": "리스트",',
        "keeps every number in list (ko)'s why re-derivable",
    ),
]

GREEN_CASES = [
    (
        "G1 a full-width pair wrapping Latin is not a half-width violation",
        ZH_SETTINGS, ZH_TYPOGRAPHY,
        ZH_BROWSER,
        '"browser_suffix": "（browser）"',
        "never uses half-width brackets in Chinese copy",
    ),
    (
        "G2 a figure spaced off its counter belongs to the figure surface",
        KO_RUNTIMES, LEDGER,
        KO_45S,
        '"description": "최근 45 초 안에 하트비트를 받았습니다. 작업을 디스패치할 준비가 되었습니다."',
        "keeps every number in particle spacing after Latin (ko)'s why re-derivable",
    ),
    (
        "G3 애널리스트 is not the word 리스트",
        KO_ONBOARDING, LEDGER,
        KO_ANALYST,
        '"research": "리서처 / 애널리스트 / 애널리스트",',
        "keeps every number in list (ko)'s why re-derivable",
    ),
]


def vitest(suite: str) -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", suite, "--reporter=verbose"],
        cwd=ROOT / "packages/views", capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def red(out: str, name: str) -> bool:
    return any(name in line and ("×" in line or "✗" in line) for line in out.splitlines())


failures = []

for label, path, suite, old, new, must_fail in CASES:
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{label}: injection anchor not unique in {path.name} ({src.count(old)})")
        print(f"MISS {label} (anchor x{src.count(old)})")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = vitest(suite)
    finally:
        path.write_text(src, encoding="utf-8")

    hit = red(out, must_fail)
    if not hit:
        failures.append(f"{label}: guard stayed green (looked for {must_fail!r})")
    print(f"{'OK  ' if hit else 'MISS'} {label}")

for label, path, suite, old, new, must_stay_green in GREEN_CASES:
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{label}: anchor not unique in {path.name} ({src.count(old)})")
        print(f"MISS {label} (anchor x{src.count(old)})")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = vitest(suite)
    finally:
        path.write_text(src, encoding="utf-8")

    green = not red(out, must_stay_green)
    if not green:
        failures.append(f"{label}: false positive — {must_stay_green!r} went red")
    print(f"{'OK  ' if green else 'FAIL'} {label}")

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
