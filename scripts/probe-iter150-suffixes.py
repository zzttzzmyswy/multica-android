#!/usr/bin/env python3
"""Iteration 150, item 3 — the angles rounds 142-149 never covered.

Three entries that previous rounds' entry points could not reach:

  A. ja suffix composition: do `〜版` / `〜中` / `〜済み` / `〜なし` / `〜された`
     stay uniform on the same kind of key? (149 only checked parentheses and
     figure spacing, never word formation.)
  B. ko dependent-noun and counter *choice*: 149 measured the *spacing* between
     a figure and its counter, never which counter is picked for a given
     meaning (`개` vs `가지` vs `건`).
  C. particle collocation for the same English word: `〜を削除` vs `〜の削除`.

Read-only. Prints raw measurements; no bundle is modified.
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages" / "views" / "locales"

MASKED = [
    re.compile(r"`[^`]*`"),
    re.compile(r"\{\{[^}]*\}\}"),
    re.compile(r"SKILL\.md"),
    re.compile(r"Skills\.sh"),
    re.compile(r"skill-name"),
    re.compile(r"@squad"),
    re.compile(r"Agent Builder"),
    re.compile(r"agent/…"),
    re.compile(r"my-workspace"),
]


def mask(value: str) -> str:
    for pattern in MASKED:
        value = pattern.sub("…", value)
    return value


def load(locale: str) -> dict:
    bundle = {}
    for path in sorted((LOCALES / locale).glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))

        def walk(node, prefix=""):
            if not isinstance(node, dict):
                bundle[f"{path.stem}.{prefix}"] = str(node)
                return
            for key, child in node.items():
                walk(child, f"{prefix}.{key}" if prefix else key)

        walk(raw)
    return bundle


EN = load("en")
BUNDLES = {loc: load(loc) for loc in ("ja", "ko")}


def header(title):
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


# ---------------------------------------------------------------- A. ja suffixes
header("A1. ja suffix families — same suffix, does the key family split?")

# Each family: a regex over the *English* source that names the same concept,
# and the ja renderings that compete for it.
SUFFIX_FAMILIES = {
    "deleted/removed state (en: deleted|removed)": (
        re.compile(r"\b(deleted|removed)\b", re.I),
        {
            "削除済み": re.compile(r"削除済み"),
            "削除された": re.compile(r"削除された"),
            "削除しました": re.compile(r"削除しました"),
            "削除": re.compile(r"削除(?!済み|された|しました)"),
        },
    ),
    "disabled state (en: disabled)": (
        re.compile(r"\bdisabled\b", re.I),
        {
            "無効": re.compile(r"無効"),
            "未有効": re.compile(r"未有効"),
            "非活性": re.compile(r"非活性"),
            "オフ": re.compile(r"オフ"),
        },
    ),
    "enabled state (en: enabled)": (
        re.compile(r"\benabled\b", re.I),
        {
            "有効": re.compile(r"有効"),
            "オン": re.compile(r"オン"),
        },
    ),
    "in-progress (en: in progress|running|loading)": (
        re.compile(r"\b(in progress|running|loading)\b", re.I),
        {
            "〜中": re.compile(r"中$|中[」)、。]"),
            "実行中": re.compile(r"実行中"),
            "処理中": re.compile(r"処理中"),
            "読み込み中": re.compile(r"読み込み中"),
        },
    ),
    "without / none (en: without|no X|none)": (
        re.compile(r"\b(without|none|no )\b", re.I),
        {
            "なし": re.compile(r"なし"),
            "無し": re.compile(r"無し"),
            "ありません": re.compile(r"ありません"),
        },
    ),
    "versioned (en: version)": (
        re.compile(r"\bversion", re.I),
        {
            "版": re.compile(r"版"),
            "バージョン": re.compile(r"バージョン"),
        },
    ),
}

for label, (en_pattern, forms) in SUFFIX_FAMILIES.items():
    keys = [k for k, v in EN.items() if en_pattern.search(v)]
    if not keys:
        print(f"\n-- {label}: no English keys matched")
        continue
    tally = {name: 0 for name in forms}
    hits = defaultdict(list)
    for key in keys:
        value = mask(BUNDLES["ja"].get(key, ""))
        for name, pattern in forms.items():
            if pattern.search(value):
                tally[name] += 1
                hits[name].append(key)
    print(f"\n-- {label}  ({len(keys)} English keys)")
    for name, count in sorted(tally.items(), key=lambda kv: -kv[1]):
        if count:
            print(f"     {count:4d}  {name}")
    # print the collision pairs: one key family taking both forms
    nonempty = [n for n, c in tally.items() if c]
    if len(nonempty) > 1:
        for name in nonempty:
            print(f"       e.g. {name}: {hits[name][:3]}")


header("A2. ja 済み family — key-by-key, is there a partition?")
for key in sorted(EN):
    en_value = EN[key]
    if not re.search(r"\b(deleted|removed)\b", en_value, re.I):
        continue
    ja_value = BUNDLES["ja"].get(key, "")
    ko_value = BUNDLES["ko"].get(key, "")
    print(f"  {key}")
    print(f"      en: {en_value!r}")
    print(f"      ja: {ja_value!r}")
    print(f"      ko: {ko_value!r}")


# ---------------------------------------------------------------- B. ko counters
header("B1. ko counter choice — which counter for which English meaning?")

# Group English sources by the noun they quantify, then see which ko counter is
# chosen. 149 only measured spacing, so this is the first read of the *choice*.
COUNTER = re.compile(r"\{\{[^}]*\}\}\s*([가-힣]+)")
NOUN_GROUPS = {
    "item(s)/thing(s)": re.compile(r"\b(items?|things?)\b", re.I),
    "task(s)": re.compile(r"\btasks?\b", re.I),
    "issue(s)": re.compile(r"\bissues?\b", re.I),
    "member(s)": re.compile(r"\bmembers?\b", re.I),
    "time(s) (occurrence)": re.compile(r"\btimes?\b", re.I),
    "run(s)": re.compile(r"\bruns?\b", re.I),
    "day(s)": re.compile(r"\bdays?\b", re.I),
    "message(s)": re.compile(r"\bmessages?\b", re.I),
    "file(s)": re.compile(r"\bfiles?\b", re.I),
    "line(s)": re.compile(r"\blines?\b", re.I),
}

for label, en_pattern in NOUN_GROUPS.items():
    rows = []
    for key, en_value in sorted(EN.items()):
        if not en_pattern.search(en_value):
            continue
        ko_value = BUNDLES["ko"].get(key, "")
        found = COUNTER.findall(mask(ko_value))
        if found:
            rows.append((key, en_value, ko_value, found))
    if not rows:
        continue
    tally = Counter(c for _, _, _, found in rows for c in found)
    print(f"\n-- {label}  ({len(rows)} keys with a placeholder+counter)")
    for counter, count in tally.most_common():
        print(f"     {count:4d}  {counter}")
    if len(tally) > 1:
        print("     collision keys:")
        for key, en_value, ko_value, found in rows:
            if len(set(found)) > 1 or True:
                print(f"       {key}: {ko_value!r}   <- en {en_value!r}")


header("B2. ko counter choice — literal figures, grouped by English noun")
for label, en_pattern in NOUN_GROUPS.items():
    rows = []
    for key, en_value in sorted(EN.items()):
        if not en_pattern.search(en_value):
            continue
        ko_value = mask(BUNDLES["ko"].get(key, ""))
        found = re.findall(r"\d+\s*([가-힣]+)", ko_value)
        if found:
            rows.append((key, en_value, ko_value, found))
    if not rows:
        continue
    tally = Counter(c for _, _, _, found in rows for c in found)
    print(f"\n-- {label}: {dict(tally.most_common(8))}")


# ---------------------------------------------------------------- C. particles
header("C1. ja particle collocation — same English word, を vs の")

PARTICLE_TARGETS = {
    "delete": re.compile(r"\bdelet(e|ed|ing|ion)\b", re.I),
    "create": re.compile(r"\bcreat(e|ed|ing|ion)\b", re.I),
    "edit": re.compile(r"\bedit(ed|ing)?\b", re.I),
    "update": re.compile(r"\bupdat(e|ed|ing)\b", re.I),
    "copy": re.compile(r"\bcop(y|ied|ying)\b", re.I),
    "save": re.compile(r"\bsav(e|ed|ing)\b", re.I),
    "install": re.compile(r"\binstall(ed|ing|ation)?\b", re.I),
    "remove": re.compile(r"\bremov(e|ed|ing|al)\b", re.I),
}

for label, en_pattern in PARTICLE_TARGETS.items():
    tally = Counter()
    examples = defaultdict(list)
    for key, en_value in sorted(EN.items()):
        if not en_pattern.search(en_value):
            continue
        ja_value = mask(BUNDLES["ja"].get(key, ""))
        # noun form: 〜の<verb-noun>  /  verb form: 〜を<verb>
        for name, pattern in {
            "を+verb (〜を削除)": re.compile(r"を[^、。]{0,6}(する|します|しました|して)"),
            "の+noun (〜の削除)": re.compile(r"の[^、。]{0,6}(削除|作成|編集|更新|コピー|保存|インストール|削除)"),
        }.items():
            if pattern.search(ja_value):
                tally[name] += 1
                examples[name].append((key, ja_value))
    print(f"\n-- {label}  ({sum(tally.values())} ja hits)")
    for name, count in tally.most_common():
        print(f"     {count:4d}  {name}")
        for key, value in examples[name][:2]:
            print(f"           {key}: {value!r}")


header("C2. ko particle collocation — 을/를 vs 의")
for label, en_pattern in PARTICLE_TARGETS.items():
    tally = Counter()
    examples = defaultdict(list)
    for key, en_value in sorted(EN.items()):
        if not en_pattern.search(en_value):
            continue
        ko_value = mask(BUNDLES["ko"].get(key, ""))
        for name, pattern in {
            "을/를+verb": re.compile(r"[을를]\s*[가-힣]{0,4}(합니다|해요|하세요|하기|하는)"),
            "의+noun": re.compile(r"의\s*[가-힣]{0,4}(삭제|생성|편집|업데이트|복사|저장|설치|제거)"),
        }.items():
            if pattern.search(ko_value):
                tally[name] += 1
                examples[name].append((key, ko_value))
    print(f"\n-- {label}  ({sum(tally.values())} ko hits)")
    for name, count in tally.most_common():
        print(f"     {count:4d}  {name}")
        for key, value in examples[name][:2]:
            print(f"           {key}: {value!r}")

print()
print("done.")
