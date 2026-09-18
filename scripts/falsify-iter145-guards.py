#!/usr/bin/env python3
"""Falsify every rule this round added: inject one defect per rule, confirm the
guard actually fails on it, then restore. A guard that only ever passes proves
nothing — this is the round's counter-evidence.

Three rules are under test.

1. The two zh bundles agreeing on the chat surface
   (`apps/mobile/lib/i18n/zh-cross-bundle.test.ts`). The cases attack the
   comparison from both sides — either bundle drifting to a third wording, a
   documented fork moving, and the *English* source changing under the guard so
   that its comparison set shrinks.

2. No zh string mixing 您 and 你 (`zh-cross-bundle.test.ts`). One case per
   bundle, plus the chat empty-state card drifting back to the polite register.

3. ja / ko rendering each concept with one native word
   (`packages/views/locales/ja-ko-concepts.test.ts`). Cases cover the Latin
   word creeping back, the native word being dropped, the two locales
   disagreeing with each other, and a retained literal being translated.

Run from the repo root: python3 scripts/falsify-iter145-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps/mobile"

MOBILE_TEST = "lib/i18n/zh-cross-bundle.test.ts"
VIEWS_TEST = "locales/ja-ko-concepts.test.ts"

V_ZH_CHAT = ROOT / "packages/views/locales/zh-Hans/chat.json"
V_EN_CHAT = ROOT / "packages/views/locales/en/chat.json"
V_ZH_AGENTS = ROOT / "packages/views/locales/zh-Hans/agents.json"
V_JA_SKILLS = ROOT / "packages/views/locales/ja/skills.json"
V_JA_SQUADS = ROOT / "packages/views/locales/ja/squads.json"
V_JA_LAYOUT = ROOT / "packages/views/locales/ja/layout.json"
V_KO_CHAT = ROOT / "packages/views/locales/ko/chat.json"
V_KO_SQUADS = ROOT / "packages/views/locales/ko/squads.json"
M_ZH = MOBILE / "lib/i18n/locales/zh.json"

PARITY = "renders every shared chat string the same way on both sides"
FORK_PIN = "keeps each documented fork at the wording both sides settled on"
PARITY_SET = "keeps the comparison set at the size the chat scan measured"
REGISTER = "keeps a single address register per string"
CARD_REGISTER = "pins the chat empty-state card to the plain register"
JA_LATIN_SKILL = "leaves no Latin skill in the ja bundle"
KO_LATIN_SKILL = "leaves no Latin skill in the ko bundle"
JA_LATIN_SQUAD = "leaves no Latin squad in the ja bundle"
JA_NATIVE_SKILL = "renders skill as スキル wherever the English names it"
KO_NATIVE_SQUAD = "renders squad as 스쿼드 wherever the English names it"
AGREEMENT = "renders the same English string with the same native word"
KEPT_LITERAL = "keeps each retained Latin value literal"

# (label, file, old, new, cwd, test_file, test_name_that_must_fail)
CASES = [
    (
        "views: a shared chat string drifting away from mobile is caught",
        V_ZH_CHAT, '"replied_in": "{{elapsed}} 内回复"', '"replied_in": "{{elapsed}} 内答复"',
        MOBILE, MOBILE_TEST, PARITY,
    ),
    (
        "mobile: a shared chat string drifting away from views is caught",
        M_ZH, '"chat.queue.clear": "全部清空"', '"chat.queue.clear": "全部清除"',
        MOBILE, MOBILE_TEST, PARITY,
    ),
    (
        "mobile: a documented fork moving to a third wording is caught",
        M_ZH, '"chat.noMessagesYet": "暂无消息"', '"chat.noMessagesYet": "暂无消息。"',
        MOBILE, MOBILE_TEST, FORK_PIN,
    ),
    (
        "views: the English source changing under the guard is caught",
        V_EN_CHAT, '"replied_in": "Replied in {{elapsed}}"',
        '"replied_in": "Replied after {{elapsed}}"',
        MOBILE, MOBILE_TEST, PARITY_SET,
    ),
    (
        "mobile: one string mixing 您 and 你 is caught",
        M_ZH, '"settings.namePlaceholder": "您的名称"', '"settings.namePlaceholder": "您的名称，你好"',
        MOBILE, MOBILE_TEST, REGISTER,
    ),
    (
        "views: one string mixing 您 and 你 is caught",
        V_ZH_AGENTS, '"banner": "您有 {{count}} 条未完成的创建"',
        '"banner": "您有 {{count}} 条未完成的创建，请查看你的草稿"',
        MOBILE, MOBILE_TEST, REGISTER,
    ),
    (
        "mobile: the chat empty-state card drifting to the polite register is caught",
        M_ZH, '"chat.emptyFirstTitle": "和你的智能体对话"',
        '"chat.emptyFirstTitle": "和您的智能体对话"',
        MOBILE, MOBILE_TEST, CARD_REGISTER,
    ),
    (
        "ja: the Latin word creeping back for skill is caught",
        V_JA_SKILLS, '"title": "まだスキルがありません"', '"title": "まだ skill がありません"',
        ROOT, VIEWS_TEST, JA_LATIN_SKILL,
    ),
    (
        "ko: the Latin word creeping back for skill is caught",
        V_KO_CHAT,
        '"skill_bundle_unavailable": "에이전트의 스킬을 내려받지 못해',
        '"skill_bundle_unavailable": "에이전트의 skill을 내려받지 못해',
        ROOT, VIEWS_TEST, KO_LATIN_SKILL,
    ),
    (
        "ja: the Latin word creeping back for squad is caught",
        V_JA_SQUADS, '"title": "スクワッド"', '"title": "Squad"',
        ROOT, VIEWS_TEST, JA_LATIN_SQUAD,
    ),
    (
        "ja: a key dropping the native word for skill is caught",
        V_JA_SKILLS,
        '"permissions_owner": "このスキルを編集・削除できます。',
        '"permissions_owner": "この項目を編集・削除できます。',
        ROOT, VIEWS_TEST, JA_NATIVE_SKILL,
    ),
    (
        "ko: a key dropping the native word for squad is caught",
        V_KO_SQUADS, '"title": "스쿼드"', '"title": "목록"',
        ROOT, VIEWS_TEST, KO_NATIVE_SQUAD,
    ),
    (
        "ja and ko disagreeing with each other is caught",
        V_JA_LAYOUT, '"squads": "スクワッド",', '"squads": "一覧",',
        ROOT, VIEWS_TEST, AGREEMENT,
    ),
    (
        "ja: a retained Latin literal being translated is caught",
        V_JA_SKILLS, '"name_placeholder": "skill-name",', '"name_placeholder": "スキル名",',
        ROOT, VIEWS_TEST, KEPT_LITERAL,
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
for cwd, test_file in [(MOBILE, MOBILE_TEST), (ROOT, VIEWS_TEST)]:
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
