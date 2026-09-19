#!/usr/bin/env python3
"""Falsify this round's guard changes: inject one defect per rule, confirm the
guard actually fails on it, then restore.

The 150 round added one guard file (`ja-ko-state-form.test.ts`), extended another
(`ja-ko-typography.test.ts`, the ko counter rule to the placeholder half),
rewrote the ledger with two new fields (`unit`, `ask`) and two new entries, and
corrected a wrong number in the conventions.mdx table. Every new rule is under
test here — a rule that cannot be made to fail is not a guard — plus the boundary
cases that must stay **green**, because the state-form rule is deliberately narrow
and a later round could tighten it into a false red.

Rules covered:

1. `has no bare state label in the passive form` — a ja bare label regressing to
   〜された.
2. `never uses 済み as a passive predicate` — 済み pulled into a possibility clause.
3. `has no bare state label in the modifier/passive form` — the ko side of 1.
4. `never uses 됨 as a sentence predicate` — the ko side of 2.
5. `keeps the state form for the adjective list and the passive for the clause` —
   the false straggler: converging `runtimes.machine.not_found_hint` onto its four
   siblings.
6. `never puts a space between a placeholder and its counter` — the ko placeholder
   rule 149 declined to assert; a single key drifting is now enough to catch it.
7. `keeps agent counter (ja) genuinely split in ja` — one of the two new ledger
   entries converging, which is the signal to settle it rather than to leave the
   ledger claiming a disagreement.
8. `routes every doc row to the same decider the ledger names` — the new `ask`
   half of the two-way property: a doc row routing to the wrong owner.
9. `has a ledger entry for every term the doc lists` — the term half, re-checked
   against the two rows this round added.
10. `keeps Webhook in Latin wherever the English names it, in <locale>` — the
    LATIN_KEPT entry this
    round added, which was nearly missed: a first measurement counted ja as
    "31 Latin vs 31 native" because the native pattern included a lowercase
    `webhook`, matching the Latin occurrences themselves. Both sides are 31 / 0.

Green cases (must stay green — these are the rule's boundaries, not its targets):

G1. A copular `済みです` predicate. `済み` is not banned from predicating a state;
    only the *passive* forms are banned. 149's `every -> some` false red is the
    precedent for pinning this.
G2. A placeholder followed by a non-counter word (`{{count}} 선택됨`). This is the
    shape 149 expected to be a false positive; the counter-set membership test is
    what keeps it out, and that is asserted here rather than argued.
G3. A `〜された` **modifier** (`削除されたエージェント`). ja uses both `済み` and
    `された` in modifier position, so only the terminal-label position is a
    partition. Without this case a later round could read claim 1 as "never use
    された" and break correct copy.

Each injection asserts its anchor is unique in the file, so a case can never
silently edit the wrong string and prove nothing.

Run from the repo root: python3 scripts/falsify-iter150-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages/views/locales"
CONVENTIONS = ROOT / "apps/docs/content/docs/developers/conventions.mdx"

STATE_FORM = "locales/ja-ko-state-form.test.ts"
TYPOGRAPHY = "locales/ja-ko-typography.test.ts"
LEDGER = "locales/unsettled-ledger.test.ts"
UNLISTED = "locales/ja-ko-unlisted-terms.test.ts"

JA_AGENTS = LOCALES / "ja/agents.json"
JA_AUTOPILOTS = LOCALES / "ja/autopilots.json"
JA_ISSUES = LOCALES / "ja/issues.json"
JA_RUNTIMES = LOCALES / "ja/runtimes.json"
JA_SETTINGS = LOCALES / "ja/settings.json"
JA_USAGE = LOCALES / "ja/usage.json"
KO_AGENTS = LOCALES / "ko/agents.json"
KO_BILLING = LOCALES / "ko/billing.json"
KO_SETTINGS = LOCALES / "ko/settings.json"
KO_USAGE = LOCALES / "ko/usage.json"

# (label, file, suite, old, new, test that must fail)
CASES = [
    (
        "ja: a bare state label regressing to された trips claim 1",
        JA_ISSUES, STATE_FORM,
        '"thread_resolved_badge": "解決済み"',
        '"thread_resolved_badge": "解決された"',
        "has no bare state label in the passive form",
    ),
    (
        "ja: 済み pulled into a possibility clause trips claim 2",
        JA_USAGE, STATE_FORM,
        '"deleted_agents": "削除済みエージェント"',
        '"deleted_agents": "削除済み可能性のあるエージェント"',
        "never uses 済み as a passive predicate",
    ),
    (
        "ko: a bare state label regressing to 된 trips claim 1 on the ko side",
        KO_SETTINGS, STATE_FORM,
        '"saved": "저장됨"',
        '"saved": "저장된"',
        "has no bare state label in the modifier/passive form",
    ),
    (
        "ko: 됨 used as a sentence predicate trips claim 2 on the ko side",
        KO_USAGE, STATE_FORM,
        '"deleted_agents": "삭제된 에이전트"',
        '"deleted_agents": "삭제됨습니다 에이전트"',
        "never uses 됨 as a sentence predicate",
    ),
    (
        "ja: converging the false straggler onto its siblings trips the pair guard",
        JA_RUNTIMES, STATE_FORM,
        '"not_found_hint": "オフライン、削除済み、またはアクセスできなくなった可能性があります。"',
        '"not_found_hint": "オフライン、削除された、またはアクセスできなくなった可能性があります。"',
        "keeps the state form for the adjective list and the passive for the clause",
    ),
    (
        "ko: one placeholder counter drifting to the spaced form trips the new rule",
        KO_BILLING, TYPOGRAPHY,
        '"member_count_other": "멤버 {{count}}명"',
        '"member_count_other": "멤버 {{count}} 명"',
        "never puts a space between a placeholder and its counter",
    ),
    (
        "ja: a native ウェブフック creeping in trips the Webhook LATIN_KEPT entry",
        JA_AUTOPILOTS, UNLISTED,
        '"webhook_url_label": "Webhook URL"',
        '"webhook_url_label": "ウェブフック URL"',
        "keeps Webhook in Latin wherever the English names it, in ja",
    ),
    (
        "ko: the same regression on the ko side is caught too",
        KO_SETTINGS, UNLISTED,
        '"webhook_secret_label": "Webhook Secret"',
        '"webhook_secret_label": "웹훅 Secret"',
        "keeps Webhook in Latin wherever the English names it, in ko",
    ),
]

# The agent-counter entry has two 個 keys, so converging only one leaves the form
# non-empty and the still-split check correctly stays green. Both have to move —
# which is itself the point: the check fires when the *form* disappears, not when
# any single key changes.
MULTI_CASES = [
    (
        "ja: converging both 個 keys trips the new agent-counter still-split check",
        JA_RUNTIMES, LEDGER,
        [
            ('"serving_count_other": "エージェント {{count}} 個"',
             '"serving_count_other": "エージェント {{count}} 件"'),
            ('"cost_by_caption_agent_other": "このランタイムのエージェント {{count}} 個"',
             '"cost_by_caption_agent_other": "このランタイムのエージェント {{count}} 件"'),
        ],
        "keeps agent counter (ja) genuinely split in ja",
    ),
]

# (label, file, old, new, test that must stay green)
GREEN_CASES = [
    (
        "ja: a copular 済みです predicate stays green (only the passive forms are banned)",
        JA_SETTINGS,
        '"saved": "保存済み"',
        '"saved": "保存済みです"',
        "never uses 済み as a passive predicate",
    ),
    (
        "ko: a placeholder followed by a non-counter stays green",
        KO_AGENTS,
        '"selected_other": "{{count}}개 선택됨"',
        '"selected_other": "{{count}} 선택됨"',
        "never puts a space between a placeholder and its counter",
    ),
    (
        "ja: a された modifier stays green (only the terminal label is a partition)",
        JA_USAGE,
        '"deleted_agents": "削除済みエージェント"',
        '"deleted_agents": "削除されたエージェント"',
        "has no bare state label in the passive form",
    ),
]

# (label, doc anchor old, doc anchor new, test that must fail)
DOC_CASES = [
    (
        "doc: a row routing to the wrong decider trips the ask half of the two-way check",
        "| typography owner — spacing, not a word choice, 211 occurrences |",
        "| locale owner — spacing, not a word choice, 211 occurrences |",
        "routes every doc row to the same decider the ledger names",
    ),
    (
        "doc: renaming a row added this round trips the term half",
        "| `Tool counter (ja)` | ja |",
        "| `Tool counter` | ja |",
        "has a ledger entry for every term the doc lists",
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

for label, path, suite, old, new, must_fail in CASES + [
    (a, CONVENTIONS, LEDGER, b, c, d) for a, b, c, d in DOC_CASES
]:
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{label}: injection anchor not unique in {path.name} ({src.count(old)})")
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

for label, path, suite, edits, must_fail in MULTI_CASES:
    src = path.read_text(encoding="utf-8")
    unique = all(src.count(old) == 1 for old, _ in edits)
    if not unique:
        counts = [src.count(old) for old, _ in edits]
        failures.append(f"{label}: injection anchors not unique in {path.name} ({counts})")
        continue
    patched = src
    for old, new in edits:
        patched = patched.replace(old, new, 1)
    path.write_text(patched, encoding="utf-8")
    try:
        out = vitest(suite)
    finally:
        path.write_text(src, encoding="utf-8")

    hit = red(out, must_fail)
    if not hit:
        failures.append(f"{label}: guard stayed green (looked for {must_fail!r})")
    print(f"{'OK  ' if hit else 'MISS'} {label}")

for label, path, old, new, must_stay_green in GREEN_CASES:
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{label}: anchor not unique in {path.name} ({src.count(old)})")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = vitest(STATE_FORM if "済み" in new or "された" in new else TYPOGRAPHY)
    finally:
        path.write_text(src, encoding="utf-8")

    green = not red(out, must_stay_green)
    if not green:
        failures.append(f"{label}: false positive — {must_stay_green!r} went red")
    print(f"{'OK  ' if green else 'FAIL'} {label}")

print("\n-- restored state --")
for suite in (STATE_FORM, TYPOGRAPHY, LEDGER, UNLISTED):
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
