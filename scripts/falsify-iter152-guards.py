#!/usr/bin/env python3
"""Falsify iteration 152's guard changes: inject one defect per rule, confirm the
guard actually fails on it, then restore.

The 152 round added no product copy — every change is to a guard, a ledger entry,
or the contract. It extended `zh-typography.test.ts` with three rules, extended
`ja-ko-notation.test.ts` with two folds, turned four free-text tallies into
re-derivable claims across three guards, lifted the ledger's `facts` mechanism
into `tally.ts`, and added a `Dash (zh)` ledger entry with a conventions.mdx row.

Every new rule is under test here — a rule that cannot be made to fail is not a
guard — plus the boundary cases that must stay **green**.

The two 151 lessons are applied literally:

  * The `it(...)` string a case names must match the suite's real test name
    character for character (150 lost two `Webhook` cases to a name mismatch),
    and the injection anchor must be unique in the target file (151 lost three).
    The harness reports both as MISS with the count, rather than as a silent
    "the guard did not fire".
  * A guard that only asserts "no X" is green on a bundle where X was deleted.
    Every count-pinning test has its own injection, so the pin is shown to bite
    in both directions.

Rules covered:

zh-typography — the three surfaces 151 measured but did not classify
  1.  `writes ！ only where the English source has !` — an exclamation the
      English does not have.
  2.  `writes ？ only where the English source has ?` — a question mark the
      English does not have.
  3.  `never doubles or stacks a terminal mark` — `！！` coming back.
  4.  `keeps both marks in use, so the rule above cannot pass vacuously` — the
      count pin, shown to bite when a mark is deleted (both marks, both bundles).
  5.  `never runs · into the word on either side` — a tight `我的任务·全部`.
  6.  `keeps the dot in use, so the rule above cannot pass vacuously`.
  7.  `records how each bundle came by its dots, without asserting it` — the
      provenance number drifting.
  8.  `never introduces an en dash the English source does not have`.
  9.  `keeps the en dash in use, so the rule above cannot pass vacuously`.
  10. `does not settle the prose dash, which the 152 round measured and left
      open` — a round quietly converging one.

ja-ko-notation — the two katakana axes 151 did not reach
  11. `folds no two runs together when the sokuon is removed` — セション.
  12. `folds no two runs together when the small kana are enlarged` — キヤツシユ.
  13. `never puts a large glide kana after an i-column kana` — キヤンセル.
  14. `keeps enough katakana for the folds to mean something` — the count pin.
  15. `names the folds that were tried` / `records the counts each fold
      produced` — the ko negative-result note, both halves.

tally.ts — the mechanism the round lifted out of the ledger
  16. `re-derives the tally each majority term was derived from` — a converged
      primary that no longer adds up, and a rival that survived.
  17. `re-derives the tally each Latin-kept term was derived from` — the
      `payload` number the round corrected from 2 to 3.
  18. `re-derives the tally the parentheses convention was derived from` — the
      same invariant on the 149 convergence.
  19. `re-derives the tally the placeholder rule was derived from` — the 150
      placeholder half.
  20. `re-derives every number the unsettled reasons state` — the `label`
      number the round corrected from 24 to 25.

ledger — the `Dash (zh)` entry
  21. `keeps every number in dash (<locale>)'s why re-derivable` — both bundles.
  22. `keeps the collision that blocks a clean partition for dash (mobile zh)` —
      the mobile empty states converging.
  23. `states the count caliber in dash (views zh-Hans)'s why` — the prefix.
  24. `has a doc row for every ledger entry` / `routes every doc row to the same
      decider the ledger names` — the two-way property, both directions.

Green cases (must stay green — these are the rules' boundaries, not their
targets):

G1. A `·` that ends the value is not "run into a word". The rule is stated as
    "attached to no word on either side" precisely so the two boundaries the
    bundle has — a dot that opens the string and one that ends it — are not
    false reds.
G2. A large kana after an i-column kana is only wrong for the *glide* kana.
    `シアター` is an ordinary i+vowel sequence; the rule must not fire on it.
G3. A `！` the English also has is the rule working, not a violation.
G4. A `–` inside a range the English also has is the rule working.
G5. A spaced doubled dash (` —— `) must not read as the ` — ` minority. This is
    the false positive the ledger's ` — ` pattern would have if it were written
    without its spaces.

Run from the repo root: python3 scripts/falsify-iter152-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages/views/locales"
CONVENTIONS = ROOT / "apps/docs/content/docs/developers/conventions.mdx"
MOBILE_ZH = ROOT / "apps/mobile/lib/i18n/locales/zh.json"

ZH_TYPOGRAPHY = "locales/zh-typography.test.ts"
NOTATION = "locales/ja-ko-notation.test.ts"
LEDGER = "locales/unsettled-ledger.test.ts"
UNLISTED = "locales/ja-ko-unlisted-terms.test.ts"
TYPOGRAPHY = "locales/ja-ko-typography.test.ts"
CONCEPTS = "locales/ja-ko-concepts.test.ts"

NOTATION_FILE = LOCALES / "ja-ko-notation.test.ts"
LEDGER_FILE = LOCALES / "unsettled-ledger.test.ts"
UNLISTED_FILE = LOCALES / "ja-ko-unlisted-terms.test.ts"
TYPOGRAPHY_FILE = LOCALES / "ja-ko-typography.test.ts"
CONCEPTS_FILE = LOCALES / "ja-ko-concepts.test.ts"

ZH_AGENTS = LOCALES / "zh-Hans/agents.json"
ZH_ISSUES = LOCALES / "zh-Hans/issues.json"
ZH_MODALS = LOCALES / "zh-Hans/modals.json"
ZH_ONBOARDING = LOCALES / "zh-Hans/onboarding.json"
ZH_AUTOPILOTS = LOCALES / "zh-Hans/autopilots.json"
JA_RUNTIMES = LOCALES / "ja/runtimes.json"
JA_SETTINGS = LOCALES / "ja/settings.json"
JA_ONBOARDING = LOCALES / "ja/onboarding.json"
KO_RUNTIMES = LOCALES / "ko/runtimes.json"

# The ja values the two katakana folds are injected into. Kept as literals so the
# anchors are exact.
JA_TAGLINE = '"tagline": "エージェントの CLI セッションを実行するマシンとクラウドワーカーです。"'
JA_CACHE = '"kpi_cache_label": "キャッシュによる節約 · {{days}} 日"'
JA_PAREN = '"intro": "エージェントを実行するには、このコンピュータにエージェントランタイム（Claude Code、Codex、Cursor など）が必要です。サーバーやリモート開発環境でも動作します。"'

MOBILE_NO_VIEWS = '"暂无已保存视图——可在此保存过滤条件、排序与分组，便于复用。"'
MOBILE_HTML_TOO_LARGE = '"文件过大，无法内联预览 — 请使用下载"'
MOBILE_FOLD_BAR = '"{{count}} {{messageCount}} · {{authors}}"'
MOBILE_SESSION_TITLE = '"AI 创建 · 对话"'
MOBILE_RESOLVED_BAR = '"已解决 · {{count}} {{messageCount}} · {{authors}}"'
MOBILE_FROM_TO = '"{{from}}–{{to}}"'
MOBILE_DELETE_TITLE = '"删除任务？"'

VIEWS_GANTT_EMPTY = '"暂无已排期的任务 — 给任意任务设置开始或截止日期，即可显示在时间轴上。"'
VIEWS_RETRY_BLOCKED = '"未重试——你没有该智能体的使用权限"'
VIEWS_ARCHIVE_AGENT = '"归档智能体？"'
VIEWS_SKILLS_EMPTY = '"已无可添加的 skill——全部都已分配给该智能体。"'
VIEWS_WELCOME = '"欢迎来到 Multica！"'
VIEWS_THANKS = '"感谢反馈！"'
VIEWS_BATCH_DELETE = '"删除 {{count}} 个任务？"'
VIEWS_RANGE = '"最大并行 task 数（{{min}}–{{max}}）"'

# (label, file, suite, old, new, test that must fail)
CASES = [
    # --- zh-typography: ！？ mirrors the English source
    (
        "zh: an ！ the English does not have trips the transcription rule",
        ZH_AGENTS, ZH_TYPOGRAPHY,
        VIEWS_ARCHIVE_AGENT,
        '"归档智能体！"',
        "writes ！ only where the English source has !",
    ),
    (
        "zh: a ？ the English does not have trips the transcription rule",
        ZH_AGENTS, ZH_TYPOGRAPHY,
        VIEWS_SKILLS_EMPTY,
        '"已无可添加的 skill——全部都已分配？"',
        "writes ？ only where the English source has ?",
    ),
    (
        "zh: a doubled mark trips the doubled-mark rule",
        ZH_ONBOARDING, ZH_TYPOGRAPHY,
        VIEWS_WELCOME,
        '"欢迎来到 Multica！！"',
        "never doubles or stacks a terminal mark",
    ),
    (
        "zh: deleting an ！ trips the count pin",
        ZH_MODALS, ZH_TYPOGRAPHY,
        VIEWS_THANKS,
        '"感谢反馈"',
        "keeps both marks in use, so the rule above cannot pass vacuously",
    ),
    (
        "zh: deleting a ？ in mobile trips the count pin there",
        MOBILE_ZH, ZH_TYPOGRAPHY,
        MOBILE_DELETE_TITLE,
        '"删除任务"',
        "keeps both marks in use, so the rule above cannot pass vacuously",
    ),
    # --- zh-typography: the middle dot
    (
        "zh: a · run into the word trips the spacing rule",
        MOBILE_ZH, ZH_TYPOGRAPHY,
        MOBILE_RESOLVED_BAR,
        '"已解决· {{count}} {{messageCount}} · {{authors}}"',
        "never runs · into the word on either side",
    ),
    (
        "zh: deleting a · trips the count pin",
        MOBILE_ZH, ZH_TYPOGRAPHY,
        MOBILE_SESSION_TITLE,
        '"AI 创建 / 对话"',
        "keeps the dot in use, so the rule above cannot pass vacuously",
    ),
    (
        "zh: dropping a dot the English also has trips the recorded provenance",
        MOBILE_ZH, ZH_TYPOGRAPHY,
        '"本地 · 这台机器"',
        '"本地，这台机器"',
        "records how each bundle came by its dots, without asserting it",
    ),
    # --- zh-typography: the en dash
    (
        "zh: an en dash the English does not have trips the range rule",
        ZH_ISSUES, ZH_TYPOGRAPHY,
        VIEWS_BATCH_DELETE,
        '"删除 {{count}}–{{n}} 个任务？"',
        "never introduces an en dash the English source does not have",
    ),
    (
        "zh: deleting the last en dash trips the count pin",
        ZH_AUTOPILOTS, ZH_TYPOGRAPHY,
        MOBILE_FROM_TO,
        '"{{from}}-{{to}}"',
        "keeps the en dash in use, so the rule above cannot pass vacuously",
    ),
    # --- zh-typography: the pointer to the open dash
    (
        "zh: converging one views dash trips the ledger pointer",
        ZH_ISSUES, ZH_TYPOGRAPHY,
        VIEWS_GANTT_EMPTY,
        '"暂无已排期的任务——给任意任务设置开始或截止日期，即可显示在时间轴上。"',
        "does not settle the prose dash, which the 152 round measured and left open",
    ),
    # --- ja-ko-notation: the sokuon fold
    (
        "ja: セション coming back trips the sokuon fold",
        JA_RUNTIMES, NOTATION,
        JA_TAGLINE,
        JA_TAGLINE.replace("セッション", "セション"),
        "folds no two runs together when the sokuon is removed",
    ),
    (
        "ja: キヤツシユ coming back trips the yoon fold",
        JA_RUNTIMES, NOTATION,
        JA_CACHE,
        JA_CACHE.replace("キャッシュ", "キヤツシユ"),
        "folds no two runs together when the small kana are enlarged",
    ),
    (
        "ja: a large glide after an i-column kana trips the absolute rule",
        JA_RUNTIMES, NOTATION,
        JA_TAGLINE,
        JA_TAGLINE.replace("セッション", "キヤンセル"),
        "never puts a large glide kana after an i-column kana",
    ),
    (
        "ja: deleting the last ッ-bearing run trips the katakana count pin",
        JA_ONBOARDING, NOTATION,
        '"other_placeholder": "例: よく聴くポッドキャスト"',
        '"other_placeholder": "例: よく聴くポドカスト"',
        "keeps enough katakana for the folds to mean something",
    ),
    (
        "ja: changing a fold count in the ko note trips the note guard",
        NOTATION_FILE, NOTATION,
        'expect(note).toContain("113 splits");',
        'expect(note).toContain("113 splits");\n    expect(note).toContain("999 splits");',
        "records the counts each fold produced",
    ),
    (
        "ja: renaming a fold in the ko note trips the name guard",
        NOTATION_FILE, NOTATION,
        "**Fold on the last vowel**",
        "**Fold on the final vowel**",
        "names the folds that were tried",
    ),
    # --- tally.ts: the converged invariant
    (
        "tally: a converged primary that no longer adds up trips the invariant",
        UNLISTED_FILE, UNLISTED,
        "primary: { pattern: /인스턴스/, expected: 8 },",
        "primary: { pattern: /인스턴스/, expected: 7 },",
        "re-derives the tally each majority term was derived from",
    ),
    (
        "tally: a rival that survived the convergence trips the same invariant",
        JA_RUNTIMES, UNLISTED,
        JA_TAGLINE,
        JA_TAGLINE.replace("です。", "です。 instance"),
        "re-derives the tally each majority term was derived from",
    ),
    (
        "tally: the payload number the round corrected trips the Latin-kept claim",
        UNLISTED_FILE, UNLISTED,
        "latinKeptClaims(/ペイロード/, /페이로드/, /(?<![A-Za-z])payloads?(?![A-Za-z])/i, 3)",
        "latinKeptClaims(/ペイロード/, /페이로드/, /(?<![A-Za-z])payloads?(?![A-Za-z])/i, 2)",
        "re-derives the tally each Latin-kept term was derived from",
    ),
    (
        "tally: a half-width pair surviving the ja convergence trips the paren claim",
        JA_ONBOARDING, TYPOGRAPHY,
        JA_PAREN,
        JA_PAREN.replace("（Claude Code、Codex、Cursor など）", "(Claude Code、Codex、Cursor など)"),
        "re-derives the tally the parentheses convention was derived from",
    ),
    (
        "tally: a spaced ko counter trips the placeholder claim",
        KO_RUNTIMES, TYPOGRAPHY,
        '"에이전트 {{count}}개"',
        '"에이전트 {{count}} 개"',
        "re-derives the tally the placeholder rule was derived from",
    ),
    (
        "tally: the label number the round corrected trips the concepts guard",
        CONCEPTS_FILE, CONCEPTS,
        '{ label: "레이블 keys", pattern: /레이블/, expected: 25 },',
        '{ label: "레이블 keys", pattern: /레이블/, expected: 24 },',
        "re-derives every number the unsettled reasons state",
    ),
    # --- ledger: the Dash (zh) entry
    (
        "ledger: a wrong —— count trips the views dash facts",
        LEDGER_FILE, LEDGER,
        '{ label: "—— keys", pattern: /——/, expected: 95 },',
        '{ label: "—— keys", pattern: /——/, expected: 94 },',
        "keeps every number in dash (views zh-Hans)'s why re-derivable",
    ),
    (
        "ledger: a wrong minority count trips the mobile dash facts",
        LEDGER_FILE, LEDGER,
        '{ label: "` — ` keys", pattern: / — /, expected: 8 },',
        '{ label: "` — ` keys", pattern: / — /, expected: 7 },',
        "keeps every number in dash (mobile zh)'s why re-derivable",
    ),
    (
        "ledger: converging the mobile empty states trips the collision",
        MOBILE_ZH, LEDGER,
        MOBILE_NO_VIEWS,
        '"暂无已保存视图 — 可在此保存过滤条件、排序与分组，便于复用。"',
        "keeps the collision that blocks a clean partition for dash (mobile zh)",
    ),
    (
        "ledger: dropping the caliber prefix trips the 150 field",
        LEDGER_FILE, LEDGER,
        '"by key: 95 keys write the doubled',
        '"95 keys write the doubled',
        "states the count caliber in dash (views zh-Hans)'s why",
    ),
    (
        "doc: removing the Dash (zh) row trips the entry-has-a-row check",
        CONVENTIONS, LEDGER,
        "| `Dash (zh)` | both zh bundles |",
        "| `Dash (zh)X` | both zh bundles |",
        "has a doc row for every ledger entry",
    ),
    (
        "doc: routing the Dash (zh) row to the wrong decider trips the routing check",
        CONVENTIONS, LEDGER,
        "| typography owner — punctuation, 98 views + 47 mobile zh keys |",
        "| locale owner — punctuation, 98 views + 47 mobile zh keys |",
        "routes every doc row to the same decider the ledger names",
    ),
]

# (label, file, suite, old, new, test that must stay green)
GREEN_CASES = [
    (
        "G1 a · that ends the value is not run into a word",
        MOBILE_ZH, ZH_TYPOGRAPHY,
        MOBILE_RESOLVED_BAR,
        '"已解决 · {{count}} {{messageCount}} · {{authors}} ·"',
        "never runs · into the word on either side",
    ),
    (
        "G2 an i+vowel sequence after an i-column kana is not a mis-sized glide",
        JA_RUNTIMES, NOTATION,
        JA_TAGLINE,
        JA_TAGLINE.replace("セッション", "シアター"),
        "never puts a large glide kana after an i-column kana",
    ),
    (
        "G3 an ！ the English source also has is the rule working",
        ZH_MODALS, ZH_TYPOGRAPHY,
        VIEWS_THANKS,
        '"太感谢反馈！"',
        "writes ！ only where the English source has !",
    ),
    (
        "G4 an en dash inside a range the English also has is the rule working",
        ZH_AGENTS, ZH_TYPOGRAPHY,
        VIEWS_RANGE,
        '"最大并行 task 数（{{min}}–{{max}} 个）"',
        "never introduces an en dash the English source does not have",
    ),
    (
        "G5 a spaced doubled dash must not read as the ` — ` minority",
        ZH_ISSUES, LEDGER,
        VIEWS_RETRY_BLOCKED,
        '"未重试 —— 你没有该智能体的使用权限"',
        "keeps every number in dash (views zh-Hans)'s why re-derivable",
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
for suite in (ZH_TYPOGRAPHY, NOTATION, LEDGER, UNLISTED, TYPOGRAPHY, CONCEPTS):
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
