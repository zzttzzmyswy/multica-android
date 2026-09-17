#!/usr/bin/env python3
"""Falsify every rule this round added: inject one defect per rule, confirm the
guard actually fails on it, then restore. A guard that only ever passes proves
nothing — this is the round's counter-evidence.

The round extended `packages/views/locales/ja-ko-concepts.test.ts` from two
concepts (`skill`, `squad`) to all fourteen that conventions.mdx section 2
names, and added three rules around it. Seven rules are under test.

1. No Latin concept word in prose (`leaves no Latin <concept> in the <locale>
   bundle`). One case per concept family the round converged: ja `daemon`,
   ko `runtime`, ja `agent`, ko `inbox`.

2. One native word per concept (`renders <concept> as <word> wherever the
   English names it`). Cases drop the native word for ja `reply` and revert ko
   `member` to the minority word.

3. The ko `reply` surface split (`splits reply by surface in ko`). The case
   collapses a comment-surface key onto the chat word.

4. ja and ko agreeing with each other. The case moves one locale off the word
   the other uses.

5. The unsettled ledger. The case gives ko `label` a native word without
   removing it from UNSETTLED, which is exactly the guess the ledger forbids.

6. The untranslated ledger. One case leaves a new prose string untranslated
   outside the documented namespaces; the other translates a documented raw
   developer string.

7. A retained Latin literal staying literal.

Run from the repo root: python3 scripts/falsify-iter146-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIEWS_TEST = "locales/ja-ko-concepts.test.ts"
LOCALES = ROOT / "packages/views/locales"
TEST_FILE = ROOT / "packages/views" / VIEWS_TEST

JA_RUNTIMES = LOCALES / "ja/runtimes.json"
JA_CHAT = LOCALES / "ja/chat.json"
JA_SKILLS = LOCALES / "ja/skills.json"
JA_SETTINGS = LOCALES / "ja/settings.json"
JA_AGENTS = LOCALES / "ja/agents.json"
JA_BILLING = LOCALES / "ja/billing.json"
KO_AGENTS = LOCALES / "ko/agents.json"
KO_ISSUES = LOCALES / "ko/issues.json"

LATIN_DAEMON_JA = "leaves no Latin daemon in the ja bundle"
LATIN_RUNTIME_KO = "leaves no Latin runtime in the ko bundle"
LATIN_AGENT_JA = "leaves no Latin agent in the ja bundle"
NATIVE_INBOX_KO = "renders inbox as 인박스 wherever the English names it"
NATIVE_REPLY_JA = "renders reply as 返信 wherever the English names it"
NATIVE_MEMBER_KO = "renders member as 멤버 wherever the English names it"
REPLY_SPLIT = "splits reply by surface in ko"
AGREEMENT = "renders the same English string with the same native word"
UNSETTLED = "records which concepts the bundle cannot settle, so nobody guesses"
LEDGER_JA = "translates every prose string outside settings.composio and settings.vcs in ja"
RAW_STRINGS = "keeps the raw developer strings identical in every locale"
KEPT_LITERAL = "keeps each retained Latin value literal"

# (label, file, old, new, test_name_that_must_fail)
CASES = [
    (
        "ja: the Latin word creeping back for daemon is caught",
        JA_RUNTIMES, '"pending_health": "デーモンに登録中"', '"pending_health": "Daemon に登録中"',
        LATIN_DAEMON_JA,
    ),
    (
        "ko: the Latin word creeping back for runtime is caught",
        KO_AGENTS,
        '"delete_dialog_description": "{{name}}은 더 이상 이 에이전트에서 사용할 수 없습니다. 런타임 서버에는 영향을 주지 않습니다."',
        '"delete_dialog_description": "{{name}}은 더 이상 이 에이전트에서 사용할 수 없습니다. Runtime Server에는 영향을 주지 않습니다."',
        LATIN_RUNTIME_KO,
    ),
    (
        "ja: the Latin word creeping back for agent is caught",
        JA_CHAT, '"view_profile": "エージェントのプロフィール"', '"view_profile": "Agent のプロフィール"',
        LATIN_AGENT_JA,
    ),
    (
        "ko: a key dropping the native word for inbox is caught",
        KO_ISSUES if False else LOCALES / "ko/settings.json",
        '"goInbox": { "label": "인박스로 이동", "description": "워크스페이스 인박스를 엽니다." }',
        '"goInbox": { "label": "받은 편지함으로 이동", "description": "워크스페이스 인박스를 엽니다." }',
        NATIVE_INBOX_KO,
    ),
    (
        "ja: a key dropping the native word for reply is caught",
        JA_CHAT, '"waiting": "返信待ち"', '"waiting": "待機中"',
        NATIVE_REPLY_JA,
    ),
    (
        "ko: a key reverting to the minority word for member is caught",
        KO_ISSUES, '"variant_members": "멤버에게 할당됨"', '"variant_members": "구성원에게 할당됨"',
        NATIVE_MEMBER_KO,
    ),
    (
        "ko: the reply surface split collapsing is caught",
        KO_ISSUES, '"reply_count_other": "답글 {{count}}개"', '"reply_count_other": "답변 {{count}}개"',
        REPLY_SPLIT,
    ),
    (
        "ja and ko disagreeing with each other is caught",
        JA_SETTINGS,
        '"goInbox": { "label": "インボックスへ移動", "description": "ワークスペースのインボックスを開きます。" }',
        '"goInbox": { "label": "受信トレイへ移動", "description": "ワークスペースのインボックスを開きます。" }',
        AGREEMENT,
    ),
    (
        "ja: leaving a new prose string untranslated is caught",
        JA_AGENTS,
        '"redacted_hint": "このエージェントが使用できるアプリを閲覧・変更できるのは作成者のみです。"',
        '"redacted_hint": "Only the agent\'s creator can view or change which apps it may use."',
        LEDGER_JA,
    ),
    (
        "ja: translating a documented raw developer string is caught",
        JA_BILLING, '"remaining_over_total": "{{remaining}} / {{total}} credits"',
        '"remaining_over_total": "{{remaining}} / {{total}} クレジット"',
        RAW_STRINGS,
    ),
    (
        "ja: a retained Latin literal being translated is caught",
        JA_SKILLS, '"name_placeholder": "skill-name",', '"name_placeholder": "スキル名",',
        KEPT_LITERAL,
    ),
]

# The unsettled ledger is falsified in the guard itself: giving ko `label` a
# native word is the guess UNSETTLED exists to prevent, and the ledger must
# refuse to let the two lists disagree.
UNSETTLED_CASE = (
    "ko: settling `label` without retiring the unsettled entry is caught",
    TEST_FILE, '{ label: "label", native: { ja: "ラベル", ko: null },',
    '{ label: "label", native: { ja: "ラベル", ko: "라벨" },',
    UNSETTLED,
)


def vitest() -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", VIEWS_TEST, "--reporter=verbose"],
        cwd=ROOT, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


failures = []
for label, path, old, new, must_fail in CASES + [UNSETTLED_CASE]:
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{label}: injection anchor not unique in {path.name} ({src.count(old)})")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = vitest()
    finally:
        path.write_text(src, encoding="utf-8")

    hit = any(must_fail in line and ("×" in line or "✗" in line) for line in out.splitlines())
    if not hit:
        failures.append(f"{label}: guard stayed green (looked for {must_fail!r})")
    print(f"{'OK  ' if hit else 'MISS'} {label}")

print("\n-- restored state --")
out = vitest()
tail = out.split("Test Files")[-1].split("\n")[0] if "Test Files" in out else out
ok = "failed" not in tail
print(f"{'OK  ' if ok else 'FAIL'} {VIEWS_TEST}")
if not ok:
    failures.append(f"{VIEWS_TEST} did not return to green after restore")

result = subprocess.run(
    ["npx", "tsc", "--noEmit"], cwd=ROOT / "packages/views", capture_output=True, text=True,
)
out = result.stdout + result.stderr
ok = "error TS" not in out
print(f"{'OK  ' if ok else 'FAIL'} packages/views tsc --noEmit")
if not ok:
    failures.append("packages/views tsc not clean after restore")

if failures:
    print("\nFAILURES:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("\nAll rules falsified, all bundles restored green.")
