#!/usr/bin/env python3
"""Falsify this round's guard change: inject one defect per rule, confirm the
guard actually fails on it, then restore.

The round translated the two settings surfaces ja and ko had never translated
(`settings.vcs`, `settings.composio`) and deleted the `UNTRANSLATED_NAMESPACES`
ledger that existed to keep them honest. Deleting it is the load-bearing change:
while it was there, every concept rule and the prose ledger skipped those keys,
so the suites were green *because* they were not looking. Each case below
injects into one of those two namespaces, which is exactly what the old filter
excluded by construction.

Four rules are under test.

1. The prose ledger (`translates every prose string in <locale>`), now
   unconditional. Both locales get a case, one per former namespace.

2. No Latin concept word in prose (`leaves no Latin <concept> in the <locale>
   bundle`), now reaching both former namespaces.

3. One native word per concept (`renders <concept> as <word> wherever the
   English names it`), now reaching both former namespaces.

4. ja and ko agreeing with each other, now reaching both former namespaces.

Run from the repo root: python3 scripts/falsify-iter147-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIEWS_TEST = "locales/ja-ko-concepts.test.ts"
LOCALES = ROOT / "packages/views/locales"
JA_SETTINGS = LOCALES / "ja/settings.json"
KO_SETTINGS = LOCALES / "ko/settings.json"

LEDGER_JA = "translates every prose string in ja"
LEDGER_KO = "translates every prose string in ko"
LATIN_AGENT_KO = "leaves no Latin agent in the ko bundle"
NATIVE_RUNTIME_JA = "renders runtime as ランタイム wherever the English names it"
AGREEMENT = "renders the same English string with the same native word"

# (label, file, namespace the anchor lives in, old, new, test that must fail)
#
# `namespace` is asserted against the anchor's own key line, so a case can never
# silently drift to a surface the old ledger did not cover — which would make the
# falsification prove nothing about the change under test.
CASES = [
    (
        "ja: an untranslated prose string in settings.vcs trips the ledger",
        JA_SETTINGS, "settings.vcs",
        '"webhook_setup_title": "プロバイダー側でセットアップを完了してください",',
        '"webhook_setup_title": "Finish setup in your provider",',
        LEDGER_JA,
    ),
    (
        "ja: an untranslated prose string in settings.composio trips the ledger",
        JA_SETTINGS, "settings.composio",
        '"empty_description": "Composio プロジェクトに有効な auth config を持つ toolkit はまだありません。Composio ダッシュボードで有効にすると、ここに表示されます。",',
        '"empty_description": "No toolkit has an enabled auth config in your Composio project yet. Enable one in the Composio dashboard to make it available here.",',
        LEDGER_JA,
    ),
    (
        "ko: an untranslated prose string in settings.vcs trips the ledger",
        KO_SETTINGS, "settings.vcs",
        '"webhook_setup_title": "제공자에서 설정을 완료하세요",',
        '"webhook_setup_title": "Finish setup in your provider",',
        LEDGER_KO,
    ),
    (
        "ko: an untranslated prose string in settings.composio trips the ledger",
        KO_SETTINGS, "settings.composio",
        '"empty_description": "Composio 프로젝트에 활성화된 auth config가 있는 toolkit이 아직 없습니다. Composio 대시보드에서 활성화하면 여기에 표시됩니다.",',
        '"empty_description": "No toolkit has an enabled auth config in your Composio project yet. Enable one in the Composio dashboard to make it available here.",',
        LEDGER_KO,
    ),
    (
        "ko: Latin `agent` creeping back into settings.composio is caught",
        KO_SETTINGS, "settings.composio",
        '"page_description": "에이전트가 사용할 수 있는 Composio 앱을 연결하세요. Composio 프로젝트에서 활성화된 auth config가 설정된 앱만 여기에 표시됩니다.",',
        '"page_description": "Agent가 사용할 수 있는 Composio 앱을 연결하세요. Composio 프로젝트에서 활성화된 auth config가 설정된 앱만 여기에 표시됩니다.",',
        LATIN_AGENT_KO,
    ),
    (
        "ja: a concept word dropped in settings.vcs is caught",
        JA_SETTINGS, "settings.vcs",
        '"page_description": "セルフホストの Forgejo、Gitea、GitLab インスタンスを接続し、Pull request をタスクにミラーリングします。接続ごとにアクセストークンを使用し、エージェントはランタイム自身の Git 認証情報でブランチを push して PR を作成します。",',
        '"page_description": "セルフホストの Forgejo、Gitea、GitLab インスタンスを接続し、Pull request をタスクにミラーリングします。接続ごとにアクセストークンを使用し、エージェントは実行環境自身の Git 認証情報でブランチを push して PR を作成します。",',
        NATIVE_RUNTIME_JA,
    ),
    (
        "ja and ko disagreeing on settings.composio is caught",
        KO_SETTINGS, "settings.composio",
        '"empty_description": "Composio 프로젝트에 활성화된 auth config가 있는 toolkit이 아직 없습니다. Composio 대시보드에서 활성화하면 여기에 표시됩니다.",',
        '"empty_description": "Composio 계정에 활성화된 auth config가 있는 toolkit이 아직 없습니다. Composio 대시보드에서 활성화하면 여기에 표시됩니다.",',
        AGREEMENT,
    ),
]


def vitest() -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", VIEWS_TEST, "--reporter=verbose"],
        cwd=ROOT, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def anchor_namespace(path: Path, anchor: str) -> str:
    """The `settings.<ns>` a `"key": value,` anchor line sits under."""
    lines = path.read_text(encoding="utf-8").splitlines()
    ns = None
    for line in lines:
        if line.startswith('  "') and line.endswith(": {"):
            ns = line.strip().strip('": {')
        if line.strip() == anchor.strip():
            return f"settings.{ns}"
    return "settings.<not found>"


failures = []
for label, path, namespace, old, new, must_fail in CASES:
    src = path.read_text(encoding="utf-8")
    if src.count(old) != 1:
        failures.append(f"{label}: injection anchor not unique in {path.name} ({src.count(old)})")
        continue
    found = anchor_namespace(path, old)
    if found != namespace:
        failures.append(f"{label}: anchor sits in {found}, expected {namespace}")
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
    for failure in failures:
        print(" -", failure)
    sys.exit(1)
print("\nAll rules falsified, both bundles restored green.")
