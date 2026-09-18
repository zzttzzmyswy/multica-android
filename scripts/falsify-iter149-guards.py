#!/usr/bin/env python3
"""Falsify this round's guard changes: inject one defect per rule, confirm the
guard actually fails on it, then restore.

The 149 round added two guard files, added a term class to the 148 guard, and
fixed a real bug in that guard's exemption self-check. Every new rule is under
test here — a rule that cannot be made to fail is not a guard — plus the one
green case that proves the bug fix (it was red before the fix and must be green
after it).

Rules covered:

1. `leaves no half-width () in the ja bundle` — the 19 converged strings
   regressing one at a time.
2. `leaves no full-width （） in the ko bundle` — the ko side of the same rule.
3. `never puts a space between a figure and its counter` — the ko figure rule.
4. `still writes the tight form …` — its anchor half, which is the only thing
   that can see a *placeholder* counter drift, since rule 3 scans literal figures
   only.
5. `keeps <term> in Latin wherever the English names it` — a Latin-kept term
   replaced by something that is neither the term nor its transliteration.
6. `never transliterates <term>` — the transliteration creeping in.
7. `keeps the collision that blocks a clean partition for <term>` — the ledger's
   whole reason for existing: if the two same-kind anchors agree, the partition
   became clean and the term is settleable.
8. `has a ledger entry for every term the doc lists` — conventions.mdx and the
   ledger drifting apart.

One case must stay **green**: the exemption self-check now uses `some`, not
`every`. Translating an exempt key in one locale only must not mark the exemption
stale, because the other locale still needs it. Under the 148 `every` this case
went red — a false red no edit could clear.

Each injection asserts that the anchor key's *English* source names the term, so
a case can never drift to a key the rule does not actually scan — which would
make the falsification prove nothing.

Run from the repo root: python3 scripts/falsify-iter149-guards.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages/views/locales"
CONVENTIONS = ROOT / "apps/docs/content/docs/developers/conventions.mdx"

TYPOGRAPHY = "locales/ja-ko-typography.test.ts"
LEDGER = "locales/unsettled-ledger.test.ts"
UNLISTED = "locales/ja-ko-unlisted-terms.test.ts"

JA_AGENTS = LOCALES / "ja/agents.json"
JA_MEMBERS = LOCALES / "ja/members.json"
JA_RUNTIMES = LOCALES / "ja/runtimes.json"
JA_SETTINGS = LOCALES / "ja/settings.json"
JA_USAGE = LOCALES / "ja/usage.json"
KO_AGENTS = LOCALES / "ko/agents.json"
KO_BILLING = LOCALES / "ko/billing.json"
KO_SETTINGS = LOCALES / "ko/settings.json"
KO_USAGE = LOCALES / "ko/usage.json"

TERM_PATTERNS = {
    "Gateway": r"(?<![A-Za-z])Gateways?(?![A-Za-z])",
    "batch": r"(?<![A-Za-z])batches?(?![A-Za-z])",
}

# (label, file, suite, term-or-None, en key the anchor belongs to, old, new, test that must fail)
CASES = [
    (
        "ja: a half-width () creeping back trips the ja punctuation rule",
        JA_MEMBERS, TYPOGRAPHY, None, "members.card.agents_section",
        '"agents_section": "エージェント（{{count}}）"',
        '"agents_section": "エージェント ({{count}})"',
        "leaves no half-width () in the ja bundle",
    ),
    (
        "ja: the same regression on a different key is caught too",
        JA_USAGE, TYPOGRAPHY, None, "usage.weekly.partial_label",
        '"partial_label": "{{range}}（一部 · 7日中 {{covered}}日）"',
        '"partial_label": "{{range}} (一部 · 7日中 {{covered}}日)"',
        "leaves no half-width () in the ja bundle",
    ),
    (
        "ko: a full-width （） appearing trips the ko punctuation rule",
        KO_SETTINGS, TYPOGRAPHY, None, "settings.dingtalk.byo_appkey_label",
        '"byo_appkey_label": "AppKey(client id)"',
        '"byo_appkey_label": "AppKey（client id）"',
        "leaves no full-width （） in the ko bundle",
    ),
    (
        "ko: spacing a figure from its counter trips the ko figure rule",
        KO_SETTINGS, TYPOGRAPHY, None, "settings.tokens.expiry.30",
        '"30": "30일"', '"30": "30 일"',
        "never puts a space between a figure and its counter",
    ),
    (
        "ko: spacing a placeholder from its counter trips the vacuity anchor",
        KO_BILLING, TYPOGRAPHY, None, "billing.workspace.current.member_count_other",
        '"member_count_other": "멤버 {{count}}명"',
        '"member_count_other": "멤버 {{count}} 명"',
        "still writes the tight form, so the rule above is not vacuous",
    ),
    (
        "ja: replacing a Latin-kept term with neither the term nor its transliteration",
        JA_AGENTS, UNLISTED, "Gateway", "agents.tab_body.runtime_config.mode_gateway",
        '"mode_gateway": "Gateway",', '"mode_gateway": "ローカル",',
        "keeps Gateway in Latin wherever the English names it, in ja",
    ),
    (
        "ja: transliterating a Latin-kept term trips the no-transliteration rule",
        JA_AGENTS, UNLISTED, "Gateway", "agents.tab_body.runtime_config.gateway_legend",
        '"gateway_legend": "Gateway エンドポイント"',
        '"gateway_legend": "ゲートウェイ エンドポイント"',
        "never transliterates Gateway in the ja bundle",
    ),
    (
        "ja: converging the Private split trips the ledger's collision check",
        JA_SETTINGS, LEDGER, None, "settings.repositories.github_private",
        '"github_private": "非公開"', '"github_private": "プライベート"',
        "keeps the collision that blocks a clean partition for Private",
    ),
]

# (label, file, old, new, test that must stay green)
GREEN_CASES = [
    (
        "an env var name is masked, not read as the Private concept",
        JA_SETTINGS,
        '"github_browse_not_configured": "リポジトリの参照には GITHUB_APP_ID と GITHUB_APP_PRIVATE_KEY が必要です。",',
        '"github_browse_not_configured": "リポジトリの参照には GITHUB_APP_PRIVATE_KEY が必要です。",',
        "leaves no Latin Private in the ja bundle",
    ),
]

# A separate shape: this one edits two files, so it cannot use the single-file
# case list above. Translating an exempt key in ko only must NOT mark the
# exemption stale, because ja still needs it — that is the `some` fix.
SOME_FIX_LABEL = "an exemption needed by one locale is not reported stale when the other stops tripping"
SOME_FIX_SUITE = UNLISTED
SOME_FIX_MUST_STAY_GREEN = "keeps every exemption load-bearing"
SOME_FIX_EDITS = [
    (KO_BILLING, '"batches": "GET /api/cloud-billing/batches",',
     '"batches": "GET /api/cloud-billing/배치",'),
]


def load_en() -> dict:
    en: dict = {}
    for path in sorted((LOCALES / "en").glob("*.json")):
        ns = path.stem
        stack = [(json.loads(path.read_text(encoding="utf-8")), "")]
        while stack:
            node, prefix = stack.pop()
            if isinstance(node, dict):
                for key, child in node.items():
                    stack.append((child, f"{prefix}.{key}" if prefix else key))
            else:
                en[f"{ns}.{prefix}"] = str(node)
    return en


EN = load_en()


def names_term(term: str, key: str) -> bool:
    return bool(re.search(TERM_PATTERNS[term], EN.get(key, ""), re.I))


def vitest(suite: str) -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", suite, "--reporter=verbose"],
        cwd=ROOT / "packages/views", capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def red(out: str, name: str) -> bool:
    return any(name in line and ("×" in line or "✗" in line) for line in out.splitlines())


failures = []

for label, path, suite, term, key, old, new, must_fail in CASES:
    if old is None:
        failures.append(f"{label}: case has no injection anchor — fill it in")
        continue
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{label}: injection anchor not unique in {path.name} ({src.count(old)})")
        continue
    if term and not names_term(term, key):
        failures.append(f"{label}: {key} does not name {term!r} in English — out of scope")
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

for label, path, old, new, must_stay_green in GREEN_CASES:
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{label}: anchor not unique in {path.name} ({src.count(old)})")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = vitest(UNLISTED)
    finally:
        path.write_text(src, encoding="utf-8")

    green = not red(out, must_stay_green)
    if not green:
        failures.append(f"{label}: false positive — {must_stay_green!r} went red")
    print(f"{'OK  ' if green else 'FAIL'} {label}")

# The `some` fix: two edits at once, and the guard must stay green.
originals = []
for path, old, new in SOME_FIX_EDITS:
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{SOME_FIX_LABEL}: anchor not unique in {path.name} ({src.count(old)})")
        originals = []
        break
    originals.append((path, src))
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
else:
    try:
        out = vitest(SOME_FIX_SUITE)
    finally:
        for path, src in originals:
            path.write_text(src, encoding="utf-8")
    green = not red(out, SOME_FIX_MUST_STAY_GREEN)
    if not green:
        failures.append(
            f"{SOME_FIX_LABEL}: false red — {SOME_FIX_MUST_STAY_GREEN!r} went red, "
            "which is the 148 `every` behaviour the fix removes"
        )
    print(f"{'OK  ' if green else 'FAIL'} {SOME_FIX_LABEL}")

# The ledger's still-split rule needs the *whole* ja bundle changed, because the
# tight form it looks for is spread over five namespaces — a single-key edit
# cannot make it disappear. So this case rewrites every ja value and restores the
# original file text afterwards.
SPLIT_LABEL = "ja: converging the figure spacing everywhere trips the ledger's still-split check"
SPLIT_MUST_FAIL = "keeps figure + counter spacing genuinely split in ja"
TIGHT_JA = re.compile(
    r"(\d)(秒|分|時間|日間|日中|日目|日|週間|週|か月|ヶ月|年|件|個|名|回|つ|人|本|枚|台|度|行|文字|ページ|階|時|泊|杯|冊)"
)


def converge_ja_figures(value):
    if isinstance(value, dict):
        return {key: converge_ja_figures(child) for key, child in value.items()}
    if isinstance(value, list):
        return [converge_ja_figures(child) for child in value]
    if isinstance(value, str):
        return TIGHT_JA.sub(lambda match: f"{match.group(1)} {match.group(2)}", value)
    return value


ja_files = sorted((LOCALES / "ja").glob("*.json"))
ja_originals = [(path, path.read_text(encoding="utf-8")) for path in ja_files]
for path in ja_files:
    data = json.loads(path.read_text(encoding="utf-8"))
    path.write_text(
        json.dumps(converge_ja_figures(data), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
try:
    out = vitest(LEDGER)
finally:
    for path, src in ja_originals:
        path.write_text(src, encoding="utf-8")
hit = red(out, SPLIT_MUST_FAIL)
if not hit:
    failures.append(f"{SPLIT_LABEL}: guard stayed green (looked for {SPLIT_MUST_FAIL!r})")
print(f"{'OK  ' if hit else 'MISS'} {SPLIT_LABEL}")

# The doc/ledger agreement rule: the doc is the file under test.
src = CONVENTIONS.read_text(encoding="utf-8")
old = "| `Private` | ja |"
new = "| `Private mode` | ja |"
if src.count(old) != 1:
    failures.append(f"doc/ledger drift: anchor not unique in conventions.mdx ({src.count(old)})")
else:
    CONVENTIONS.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = vitest(LEDGER)
    finally:
        CONVENTIONS.write_text(src, encoding="utf-8")
    must_fail = "has a ledger entry for every term the doc lists"
    hit = red(out, must_fail)
    if not hit:
        failures.append(f"doc/ledger drift: guard stayed green (looked for {must_fail!r})")
    print(f"{'OK  ' if hit else 'MISS'} renaming a conventions.mdx row trips the doc/ledger agreement")

print("\n-- restored state --")
for suite in (TYPOGRAPHY, LEDGER, UNLISTED):
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

if failures:
    print("\nFAILURES:")
    for failure in failures:
        print(" -", failure)
    sys.exit(1)
print("\nAll rules falsified, all bundles restored green.")
