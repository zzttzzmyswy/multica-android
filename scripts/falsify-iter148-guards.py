#!/usr/bin/env python3
"""Falsify this round's guard change: inject one defect per rule, confirm the
guard actually fails on it, then restore.

The round converged six terms ja and ko rendered with Latin or with a stray
second word, and pinned the `Pull request` casing. `ja-ko-unlisted-terms.test.ts`
is new, so every rule in it is under test — a rule that cannot be made to fail
is not a guard.

Rules covered:

1. `leaves no Latin <term> in the <locale> bundle` — the term creeping back.
2. `renders <term> as <word> wherever the English names it` — the word dropped
   without any Latin appearing, which rule 1 cannot see.
3. `never capitalises Pull request differently` — the one outlier casing.
4. `writes Pull request wherever the English names it` — the term shortened to
   `PR`, which rule 3 cannot see.
5. `names the Private access level the way its own control does` — the prose
   drifting to the *runtime* word for the same concept.
6. `keeps every exemption load-bearing` — an exempt key that no longer needs it.

One further case must stay green: a SCREAMING_SNAKE_CASE env var name contains
`PRIVATE`, and the mask has to stop it reading as the Private concept. Without
that check the mask could be dropped and the suite would still look correct —
it would just start failing on the next env var someone documents.

Each injection asserts that the anchor key's *English* source names the term, so
a case can never drift to a key the rule does not actually scan — which would
make the falsification prove nothing.

Run from the repo root: python3 scripts/falsify-iter148-guards.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIEWS_TEST = "locales/ja-ko-unlisted-terms.test.ts"
LOCALES = ROOT / "packages/views/locales"

JA_AGENTS = LOCALES / "ja/agents.json"
JA_BILLING = LOCALES / "ja/billing.json"
JA_RUNTIMES = LOCALES / "ja/runtimes.json"
JA_SETTINGS = LOCALES / "ja/settings.json"
JA_WORKSPACE = LOCALES / "ja/workspace.json"
KO_AGENTS = LOCALES / "ko/agents.json"
KO_BILLING = LOCALES / "ko/billing.json"
KO_USAGE = LOCALES / "ko/usage.json"

TERM_PATTERNS = {
    "instance": r"(?<![A-Za-z])instances?(?![A-Za-z])",
    "desktop": r"(?<![A-Za-z])desktop(?![A-Za-z])",
    "provider": r"(?<![A-Za-z])providers?(?![A-Za-z])",
    "batch": r"(?<![A-Za-z])batches?(?![A-Za-z])",
    "heartbeat": r"(?<![A-Za-z])heartbeats?(?![A-Za-z])",
    "tier": r"(?<![A-Za-z])tiers?(?![A-Za-z])",
    "pull request": r"(?<![A-Za-z])pull requests?(?![A-Za-z])",
    "private": r"(?<![A-Za-z])private(?![A-Za-z])",
}

# (label, file, term, en key the anchor belongs to, old, new, test that must fail)
CASES = [
    (
        "ja: Latin `instance` creeping back trips the no-Latin rule",
        JA_WORKSPACE, "instance", "workspace.creation_disabled.description",
        "この Multica インスタンスでは", "この Multica instanceでは",
        "leaves no Latin instance in the ja bundle",
    ),
    (
        "ja: dropping the native word trips the one-word rule",
        JA_RUNTIMES, "desktop", "runtimes.update.managed_by_desktop",
        '"managed_by_desktop": "デスクトップで管理",',
        '"managed_by_desktop": "アプリで管理",',
        "renders desktop as デスクトップ wherever the English names it",
    ),
    (
        "ko: Latin `batch` creeping back trips the no-Latin rule",
        KO_BILLING, "batch", "billing.batches.title",
        '"title": "크레딧 배치",', '"title": "크레딧 batch",',
        "leaves no Latin batch in the ko bundle",
    ),
    (
        "ko: `프로바이더` instead of `제공자` trips the one-word rule",
        KO_USAGE, "provider", "usage.errors.class.provider",
        '"provider": "제공자",', '"provider": "프로바이더",',
        "renders provider as 제공자 wherever the English names it",
    ),
    (
        "ja: `Pull Request` creeping back trips the casing rule",
        JA_AGENTS, "pull request", "agents.creation_studio.builder.prompt_review",
        "フロントエンドの Pull request をレビュー", "フロントエンドの Pull Request をレビュー",
        "never capitalises Pull request differently in the ja bundle",
    ),
    (
        "ko: shortening to `PR` trips the Latin-term rule",
        KO_AGENTS, "pull request", "agents.creation_studio.builder.prompt_review",
        "프런트엔드 Pull request 검토", "프런트엔드 PR 검토",
        "writes Pull request wherever the English names it, in ko",
    ),
    (
        "ja: Latin `Private` creeping back trips the no-Latin rule",
        JA_AGENTS, "private", "agents.tab_body.composio_mcp.shared_warning",
        "場合は、プライベートにするかアクセス範囲を絞ってください。",
        "場合は、Private にするかアクセス範囲を絞ってください。",
        "leaves no Latin Private in the ja bundle",
    ),
    (
        "ja: naming the access level with the runtime word trips the consistency rule",
        JA_AGENTS, "private", "agents.tab_body.composio_mcp.shared_warning",
        "場合は、プライベートにするかアクセス範囲を絞ってください。",
        "場合は、非公開にするかアクセス範囲を絞ってください。",
        "names the Private access level the way its own control does, in ja",
    ),
    (
        "an exemption that is no longer needed is caught",
        JA_BILLING, "batch", "billing.endpoints.batches",
        '"batches": "GET /api/cloud-billing/batches",',
        '"batches": "GET /api/cloud-billing/バッチ",',
        "keeps every exemption load-bearing",
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
    pattern = re.compile(TERM_PATTERNS[term], re.I)
    return bool(pattern.search(EN.get(key, "")))


def vitest() -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", VIEWS_TEST, "--reporter=verbose"],
        cwd=ROOT, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def red(out: str, name: str) -> bool:
    return any(name in line and ("×" in line or "✗" in line) for line in out.splitlines())


failures = []

for label, path, term, key, old, new, must_fail in CASES:
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{label}: injection anchor not unique in {path.name} ({src.count(old)})")
        continue
    if not names_term(term, key):
        failures.append(f"{label}: {key} does not name {term!r} in English — out of scope")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = vitest()
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
        out = vitest()
    finally:
        path.write_text(src, encoding="utf-8")

    green = not red(out, must_stay_green)
    if not green:
        failures.append(f"{label}: false positive — {must_stay_green!r} went red")
    print(f"{'OK  ' if green else 'FAIL'} {label}")

print("\n-- restored state --")
out = vitest()
ok = "failed" not in out.split("Test Files")[-1].split("\n")[0]
print(f"{'OK  ' if ok else 'FAIL'} {VIEWS_TEST}")
if not ok:
    failures.append(f"{VIEWS_TEST} did not return to green after restore")

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
print("\nAll rules falsified, both bundles restored green.")
