#!/usr/bin/env python3
"""Falsify iteration 151's guard changes: inject one defect per rule, confirm the
guard actually fails on it, then restore.

The 151 round added two guard files (`zh-typography.test.ts`,
`ja-ko-notation.test.ts`), extended two (`zh-glossary.test.ts` with three
concepts and a carve-out list, `ja-ko-unlisted-terms.test.ts` with `Fleet` and a
RegExp `native`), added a `facts` field to every ledger entry plus a new
`ブラウザ` entry, and corrected numbers in the conventions.mdx table and prose.
Every new rule is under test here — a rule that cannot be made to fail is not a
guard — plus the boundary cases that must stay **green**.

Two lessons from round 150 are applied literally:

  * The `it(...)` string a case names must match the suite's real test name
    character for character. Round 150 reported a MISS on two `Webhook` cases for
    exactly this reason, and a MISS reads as "the guard did not fire" when the
    truth was "the harness looked for the wrong name".
  * A guard that only asserts "no X" is green on a bundle where the thing it
    guards was deleted. Every count-pinning test therefore has its own injection,
    so the pin is shown to bite in both directions.

Rules covered:

1.  `uses straight double quotes, never 「」` — a 「」 pair coming back.
2.  `uses straight double quotes, never curly ones` — a curly pair coming back.
3.  `uses full-width ，inside a Chinese sentence` — a half-width comma in prose.
4.  `uses full-width ；inside a Chinese sentence` — a half-width semicolon.
5.  `uses full-width ？！` — a half-width `?` in Chinese copy.
6.  `never uses half-width brackets in Chinese copy` — the derived bracket rule.
7.  `keeps both bracket forms measured, so the rule cannot pass vacuously` — the
    count pin, shown to bite when the majority form is removed.
8.  `keeps every surviving concept token on the code-reference list` — Latin
    `Autopilot` / `Members` / entity `issues` coming back into zh-Hans.
9.  `renders the concept in Chinese wherever the English names it` — the other
    direction of the same rule.
10. `keeps every carve-out rendering the sense the guide carved out` — the
    machine-health carve-out drifting to 任务.
11. `never writes a rival spelling of <word>` — the ja notation pins.
12. `still writes <word> as often as the derivation measured` — the tally pins,
    shown to bite when the word is deleted.
13. `converged フォルダ, so no フォルダー survives` — the straggler returning.
14. `left ブラウザ open, with both spellings still in use` — the open split being
    silently converged without deleting the ledger entry.
15. `keeps every number in <entry>'s why re-derivable` — the new `facts`
    invariant, on a number, on a scope, and on a cross-locale claim.
16. `keeps <entry> genuinely split` — a ledger entry converging.
17. `states the count caliber in <entry>'s why` — the 150 field, re-checked.
18. `keeps every doc row's Ask cell non-empty` / `has a doc row for every ledger
    entry` — the two-way property, both directions.
19. `keeps Fleet in Latin wherever the English names it, in <locale>` — the term
    this round added, plus the `템플릿` false-positive guard around it.

Green cases (must stay green — these are the rule's boundaries, not its targets):

G1. A `템플릿` (template) in ko. `Fleet`'s native pattern is `(?<!템)플릿`; without
    that lookbehind the correct word for *template* would be reported as a
    transliterated *fleet*, which is the exact false positive this round
    corrected.
G2. A full-width bracket pair wrapping a placeholder (`（{{count}}）`). The first
    reading of the bracket rule — half-width wraps Latin, full-width wraps
    Chinese — would have made this a violation; it is the majority shape.
G3. The literal enum value `completed, failed` with its half-width comma. It is a
    value the user matches against a status list, not prose.
G4. A `{{binding}}`-only change in an unrelated ja key. The notation tally pins
    must not read as "no ja key may change".

Run from the repo root: python3 scripts/falsify-iter151-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages/views/locales"
CONVENTIONS = ROOT / "apps/docs/content/docs/developers/conventions.mdx"
MOBILE_ZH = ROOT / "apps/mobile/lib/i18n/locales/zh.json"

ZH_TYPOGRAPHY = "locales/zh-typography.test.ts"
ZH_GLOSSARY = "locales/zh-glossary.test.ts"
NOTATION = "locales/ja-ko-notation.test.ts"
LEDGER = "locales/unsettled-ledger.test.ts"
LEDGER_FILE = LOCALES / "unsettled-ledger.test.ts"
UNLISTED = "locales/ja-ko-unlisted-terms.test.ts"

ZH_EDITOR = LOCALES / "zh-Hans/editor.json"
ZH_ISSUES = LOCALES / "zh-Hans/issues.json"
ZH_AGENTS = LOCALES / "zh-Hans/agents.json"
ZH_AUTOPILOTS = LOCALES / "zh-Hans/autopilots.json"
ZH_RUNTIMES = LOCALES / "zh-Hans/runtimes.json"
ZH_BILLING = LOCALES / "zh-Hans/billing.json"
ZH_SETTINGS = LOCALES / "zh-Hans/settings.json"
JA_SKILLS = LOCALES / "ja/skills.json"
JA_SETTINGS = LOCALES / "ja/settings.json"
JA_AUTOPILOTS = LOCALES / "ja/autopilots.json"
KO_AGENTS = LOCALES / "ko/agents.json"
KO_RUNTIMES = LOCALES / "ko/runtimes.json"

# (label, file, suite, old, new, test that must fail)
CASES = [
    # --- zh-typography: the settled half of section 3
    (
        "zh: a 「」 pair coming back trips the quote rule",
        ZH_BILLING, ZH_TYPOGRAPHY,
        r'请到\"工作区设置 → 账单\"确认当前状态。',
        '请到「工作区设置 → 账单」确认当前状态。',
        "uses straight double quotes, never 「」",
    ),
    (
        "zh: a curly pair coming back trips the same rule",
        ZH_SETTINGS, ZH_TYPOGRAPHY,
        "\\\"{{name}}\\\"将从选择器和筛选中隐藏",
        "“{{name}}”将从选择器和筛选中隐藏",
        "uses straight double quotes, never curly ones",
    ),
    (
        "zh: a half-width comma in prose trips the comma rule",
        ZH_EDITOR, ZH_TYPOGRAPHY,
        "这张图片已失效，已跳过。",
        "这张图片已失效,已跳过。",
        "uses full-width ，inside a Chinese sentence",
    ),
    (
        "zh: a half-width semicolon trips the semicolon rule",
        ZH_AGENTS, ZH_TYPOGRAPHY,
        "已应用 {{succeeded}} 个；{{failed}} 个失败",
        "已应用 {{succeeded}} 个;{{failed}} 个失败",
        "uses full-width ；inside a Chinese sentence",
    ),
    (
        "zh: a half-width ? in Chinese copy trips the ？！ rule",
        ZH_EDITOR, ZH_TYPOGRAPHY,
        "双击可切换实际大小。",
        "双击可切换实际大小?",
        "uses full-width ？！",
    ),
    (
        "zh: a half-width bracket pair trips the derived bracket rule",
        ZH_ISSUES, ZH_TYPOGRAPHY,
        r'\"{{name}}\"将对所有可见成员删除',
        '基于({{name}})将对所有可见成员删除',
        "never uses half-width brackets in Chinese copy",
    ),
    # --- zh-typography: the count pin, in the other direction
    (
        "zh: removing the majority bracket form trips the count pin",
        ZH_SETTINGS, ZH_TYPOGRAPHY,
        '"browser_suffix": "（浏览器）"',
        '"browser_suffix": "(浏览器)"',
        "keeps both bracket forms measured, so the rule cannot pass vacuously",
    ),
    # --- zh-glossary: three new concepts, both directions
    (
        "zh: Latin Autopilot coming back trips the concept scan",
        ZH_AUTOPILOTS, ZH_GLOSSARY,
        "自动化创建后 Multica 会生成一个 Webhook URL。",
        "Autopilot 创建后 Multica 会生成一个 Webhook URL。",
        "keeps every surviving concept token on the code-reference list",
    ),
    (
        "zh: Latin Members coming back trips the concept scan",
        ZH_AGENTS, ZH_GLOSSARY,
        "你可以在成员标签里手动添加。",
        "你可以在 Members 标签里手动添加。",
        "keeps every surviving concept token on the code-reference list",
    ),
    (
        "zh: entity issues coming back trips the concept scan",
        ZH_ISSUES, ZH_GLOSSARY,
        "基于工作区全部任务创建",
        "基于工作区全部 issues 创建",
        "keeps every surviving concept token on the code-reference list",
    ),
    (
        "zh: dropping 任务 where the English names an issue trips the other direction",
        ZH_ISSUES, ZH_GLOSSARY,
        "我的任务视图仅自己可见",
        "我的视图仅自己可见",
        "renders the concept in Chinese wherever the English names it",
    ),
    (
        "zh: a machine-health carve-out drifting to 任务 trips the carve-out guard",
        ZH_RUNTIMES, ZH_GLOSSARY,
        "\"health_issues_other\": \"{{count}} 个异常\"",
        "\"health_issues_other\": \"{{count}} 个任务\"",
        "keeps every carve-out rendering the sense the guide carved out",
    ),
    # --- ja-ko-notation: the pins, both directions
    (
        "ja: the short form サーバ coming back trips the long-vowel pin",
        JA_SETTINGS, NOTATION,
        '"add_server": "サーバーを追加"',
        '"add_server": "サーバを追加"',
        "never writes a rival spelling of サーバー",
    ),
    (
        "ja: ディフォルト coming back trips the vowel pin",
        JA_SETTINGS, NOTATION,
        '"reset_all": "デフォルトに戻す"',
        '"reset_all": "ディフォルトに戻す"',
        "never writes a rival spelling of デフォルト",
    ),
    (
        "ja: deleting the pinned word trips the tally pin",
        JA_SETTINGS, NOTATION,
        '"label": "オーナー"',
        '"label": "持ち主"',
        "still writes オーナー as often as the derivation measured",
    ),
    (
        "ja: the converged フォルダー straggler coming back trips the split guard",
        JA_SKILLS, NOTATION,
        "同名のフォルダが既に存在します",
        "同名のフォルダーが既に存在します",
        "converged フォルダ, so no フォルダー survives",
    ),
    (
        "ja: silently converging ブラウザ without touching the ledger trips the pointer",
        JA_SETTINGS, NOTATION,
        "ブラウザーのように履歴を戻ります。",
        "ブラウザのように履歴を戻ります。",
        "left ブラウザ open, with both spellings still in use",
    ),
    # --- ledger: the facts invariant, three shapes
    (
        "ledger: a wrong number in a why trips the facts invariant",
        LEDGER_FILE, LEDGER,
        "{ label: \"검토 keys\", pattern: /검토/, expected: 9 },",
        "{ label: \"검토 keys\", pattern: /검토/, expected: 10 },",
        "keeps every number in review's why re-derivable",
    ),
    (
        "ledger: a wrong scope in a fact trips the same invariant",
        LEDGER_FILE, LEDGER,
        'scope: "settings.mcp.",\n        pattern: /(?<![A-Za-z])Servers?(?![A-Za-z])|サーバー/,\n        expected: 15,',
        'scope: "settings.mcp.",\n        pattern: /(?<![A-Za-z])Servers?(?![A-Za-z])|サーバー/,\n        expected: 20,',
        "keeps every number in Server (ja)'s why re-derivable",
    ),
    (
        "ledger: a cross-locale claim that stops being true trips the same invariant",
        KO_AGENTS, LEDGER,
        '"agent_count_other": "에이전트 {{count}}개"',
        '"agent_count_other": "에이전트 {{count}}건"',
        "keeps every number in agent counter (ja)'s why re-derivable",
    ),
    (
        "ledger: converging a split without settling it trips the split guard",
        JA_SETTINGS, LEDGER,
        '"admin_only_note": "共有 MCP サーバーを変更できるのはワークスペースの owner と admin のみです。"',
        '"admin_only_note": "共有 MCP サーバーを変更できるのはワークスペースの オーナー と 管理者 のみです。"',
        "keeps the collision that blocks a clean partition for roles (ja)",
    ),
    (
        "ledger: dropping the caliber prefix trips the 150 field",
        LEDGER_FILE, LEDGER,
        '"by key: 11 ブラウザ vs 2 ブラウザー',
        '"11 ブラウザ vs 2 ブラウザー',
        "states the count caliber in browser notation (ja)'s why",
    ),
    # --- ledger <-> conventions.mdx, both directions
    (
        "doc: emptying an Ask cell trips the two-way routing check",
        CONVENTIONS, LEDGER,
        "| locale owner — counter choice, 18 ja keys |",
        "|  |",
        "keeps every doc row's Ask cell non-empty, including the ellipsis row",
    ),
    (
        "doc: removing the ブラウザ row trips the entry-has-a-row check",
        CONVENTIONS, LEDGER,
        "| `ブラウザ` | ja | by key: 11 ブラウザ",
        "| `ブラウザX` | ja | by key: 11 ブラウザ",
        "has a doc row for every ledger entry",
    ),
    # --- LATIN_KEPT: the term this round added
    (
        "ja: a native フリート creeping in trips the Fleet entry",
        JA_AUTOPILOTS, UNLISTED,
        '"webhook_url_label": "Webhook URL"',
        '"webhook_url_label": "Webhook URL フリート"',
        "never transliterates Fleet in the ja bundle",
    ),
    (
        "ko: a real 플릿 creeping in trips the Fleet entry on the ko side",
        KO_RUNTIMES, UNLISTED,
        '"nodes_title": "Fleet 노드"',
        '"nodes_title": "플릿 노드"',
        "keeps Fleet in Latin wherever the English names it, in ko",
    ),
]

# (label, file, suite, old, new, test that must stay green)
GREEN_CASES = [
    (
        "G1 ko 템플릿 (template) must not read as a transliterated Fleet",
        KO_AGENTS, UNLISTED,
        '"title": "템플릿 사용"',
        '"title": "템플릿 사용하기"',
        "never transliterates Fleet in the ko bundle",
    ),
    (
        "G2 a full-width bracket around a placeholder is the majority shape",
        ZH_SETTINGS, ZH_TYPOGRAPHY,
        '"browser_suffix": "（浏览器）"',
        '"browser_suffix": "（浏览器 {{count}}）"',
        "never uses half-width brackets in Chinese copy",
    ),
    (
        "G3 the literal enum value keeps its half-width comma",
        ZH_AUTOPILOTS, ZH_TYPOGRAPHY,
        '"event_filter_actions_placeholder": "completed, failed"',
        '"event_filter_actions_placeholder": "completed, failed, queued"',
        "uses full-width ，inside a Chinese sentence",
    ),
    (
        "G4 an unrelated ja binding change is not a notation regression",
        JA_AUTOPILOTS, NOTATION,
        '"webhook_url_label": "Webhook URL"',
        '"webhook_url_label": "Webhook URL {{id}}"',
        "never writes a rival spelling of ブラウザ",
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
for suite in (ZH_TYPOGRAPHY, ZH_GLOSSARY, NOTATION, LEDGER, UNLISTED):
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
