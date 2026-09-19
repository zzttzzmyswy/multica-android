#!/usr/bin/env python3
"""Iteration 149: converge the 19 ja strings that still use half-width ().

147 settled "ja uses full-width （）, ko uses half-width ()". The ko side holds
with zero exceptions (129 half-width pairs, 0 full-width). The ja side does not:
66 full-width pairs against 19 half-width ones, spread over 19 keys, with no
partition behind them — the same key shape appears both ways inside one
namespace, and the parenthetical content is native text 11 times and Latin 8
times, so neither "content kind" nor "surface" separates the two forms.

So the 19 are stragglers of an already-settled rule, not a new decision. This
script converts them and nothing else.

Every replacement is keyed by the exact JSON line and asserts it matches exactly
once, because these values are short and several appear as substrings of other
strings (`settings.json` also has inline objects, so a whole-file JSON rewrite
would reformat it).

Two conventions the conversions follow, both read off the bundle rather than
invented:

  - No space between the text and the full-width （. The bundle has 66 full-width
    pairs and zero occurrences of `） ` (close paren followed by a space), so a
    full-width pair never carries a surrounding space.
  - The space that separated a Latin token from the old half-width pair is
    dropped with it: `Lark (飞书) PersonalAgent` -> `Lark（飞书）PersonalAgent`.

Run from the repo root: python3 scripts/apply-iter149-translations.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages/views/locales"

# (file, key, old line, new line)
EDITS = [
    ("agents.json", "agents.create_dialog.duplicate_copy_suffix",
     '"duplicate_copy_suffix": " (コピー)"',
     '"duplicate_copy_suffix": "（コピー）"'),
    ("agents.json", "agents.page.show_archived",
     '"show_archived": "アーカイブ済みを表示 ({{count}}) →"',
     '"show_archived": "アーカイブ済みを表示（{{count}}）→"'),
    ("agents.json", "agents.row_actions.set_access_bulk_partial",
     '"set_access_bulk_partial": "{{succeeded}} 件適用、{{failed}} 件失敗(現在の状態を維持)。"',
     '"set_access_bulk_partial": "{{succeeded}} 件適用、{{failed}} 件失敗（現在の状態を維持）。"'),
    ("agents.json", "agents.row_actions.set_access_skipped",
     '"set_access_skipped": "{{count}} 件スキップ(あなた所有ではありません)。"',
     '"set_access_skipped": "{{count}} 件スキップ（あなた所有ではありません）。"'),
    ("autopilots.json", "autopilots.add_trigger_dialog.label_field",
     '"label_field": "ラベル(任意)"',
     '"label_field": "ラベル（任意）"'),
    ("autopilots.json", "autopilots.dialog.webhook_help_edit",
     "URL の管理(コピー / 再生成)はオートパイロットの詳細ページで行ってください。",
     "URL の管理（コピー / 再生成）はオートパイロットの詳細ページで行ってください。"),
    ("issues.json", "issues.execution_log.hide_past",
     '"hide_past": "過去の実行を非表示 ({{count}})"',
     '"hide_past": "過去の実行を非表示（{{count}}）"'),
    ("issues.json", "issues.execution_log.show_past",
     '"show_past": "過去の実行を表示 ({{count}})"',
     '"show_past": "過去の実行を表示（{{count}}）"'),
    ("members.json", "members.card.agents_section",
     '"agents_section": "エージェント ({{count}})"',
     '"agents_section": "エージェント（{{count}}）"'),
    ("onboarding.json", "onboarding.cli_install.intro",
     "エージェントランタイム(Claude Code、Codex、Cursor など)が必要です。",
     "エージェントランタイム（Claude Code、Codex、Cursor など）が必要です。"),
    ("onboarding.json", "onboarding.step_platform.stage_normal_suffix",
     "コンピュータが自動でここに表示されます(通常 10〜30 秒)。",
     "コンピュータが自動でここに表示されます（通常 10〜30 秒）。"),
    ("runtimes.json", "runtimes.page.no_matches.with_query_filter_suffix",
     '"with_query_filter_suffix": "(このフィルター内)"',
     '"with_query_filter_suffix": "（このフィルター内）"'),
    ("runtimes.json", "runtimes.usage.heatmap_caption",
     "日別の $ 強度(ここでは期間セレクターは無視されます)",
     "日別の $ 強度（ここでは期間セレクターは無視されます）"),
    ("runtimes.json", "runtimes.usage.weekly_partial_label",
     '"weekly_partial_label": "{{range}}(一部 · 7 日中 {{covered}} 日)"',
     '"weekly_partial_label": "{{range}}（一部 · 7 日中 {{covered}} 日）"'),
    ("search.json", "search.commands.copy_identifier",
     '"copy_identifier": "識別子をコピー ({{identifier}})"',
     '"copy_identifier": "識別子をコピー（{{identifier}}）"'),
    ("settings.json", "settings.lark.page_description",
     "Lark (飞书) PersonalAgent ボット",
     "Lark（飞书）PersonalAgent ボット"),
    ("settings.json", "settings.preferences.timezone.browser_suffix",
     '"browser_suffix": " (ブラウザ)"',
     '"browser_suffix": "（ブラウザ）"'),
    ("settings.json", "settings.wecom.page_description",
     "WeCom (企业微信) スマートボット",
     "WeCom（企业微信）スマートボット"),
    ("usage.json", "usage.weekly.partial_label",
     '"partial_label": "{{range}} (一部 · 7日中 {{covered}}日)"',
     '"partial_label": "{{range}}（一部 · 7日中 {{covered}}日）"'),
]

failures = []
for name, key, old, new in EDITS:
    path = LOCALES / "ja" / name
    src = path.read_text(encoding="utf-8")
    count = src.count(old)
    if count != 1:
        failures.append(f"{key}: anchor matched {count} times in ja/{name}, expected 1")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    print(f"OK   {key}")

if failures:
    print("\nFAILURES:")
    for failure in failures:
        print(" -", failure)
    sys.exit(1)
print(f"\n{len(EDITS)} ja strings converted to full-width parentheses.")
