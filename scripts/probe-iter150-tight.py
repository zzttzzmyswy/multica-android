#!/usr/bin/env python3
"""Iteration 150, item 3 — tight re-measurement.

The first pass used a loose window (`の[^、。]{0,6}<verb>`) that matched a `の`
anywhere in the six characters before the verb, so `右側の設定は完全に削除` counted
as a `の`-collocation. This pass requires adjacency.

Read-only.
"""

import json
import re
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
JA = load("ja")
KO = load("ko")


def header(title):
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


# ---------------------------------------------------------------------------
header("C1-tight. ja — noun-phrase の vs verb-phrase を, adjacent only")

# The action nouns both languages nominalise. Adjacency required on both sides.
JA_ACTION_NOUN = "削除|作成|編集|更新|コピー|保存|インストール|再生成|解除|接続|追加|送信|実行"
JA_NOUN_PHRASE = re.compile(rf"の(?:{JA_ACTION_NOUN})")
JA_VERB_PHRASE = re.compile(r"を[^、。！？]{0,10}(?:する|します|しました|して|し、|した)")

VERBS = {
    "delete": re.compile(r"\bdelet(e|ed|ing|ion)\b", re.I),
    "create": re.compile(r"\bcreat(e|ed|ing|ion)\b", re.I),
    "edit": re.compile(r"\bedit(ed|ing|or)?\b", re.I),
    "update": re.compile(r"\bupdat(e|ed|ing)\b", re.I),
    "copy": re.compile(r"\bcop(y|ied|ying)\b", re.I),
    "save": re.compile(r"\bsav(e|ed|ing)\b", re.I),
    "install": re.compile(r"\binstall(ed|ing|ation)?\b", re.I),
    "remove": re.compile(r"\bremov(e|ed|ing|al)\b", re.I),
}

for label, en_pattern in VERBS.items():
    keys = [k for k, v in EN.items() if en_pattern.search(v)]
    noun_keys, verb_keys = [], []
    for key in keys:
        value = mask(JA.get(key, ""))
        if JA_NOUN_PHRASE.search(value):
            noun_keys.append(key)
        if JA_VERB_PHRASE.search(value):
            verb_keys.append(key)
    both = sorted(set(noun_keys) & set(verb_keys))
    print(
        f"  {label:8s}  {len(keys):3d} en keys | の+noun {len(noun_keys):3d} | "
        f"を+verb {len(verb_keys):3d} | both {len(both):2d}"
    )
    for key in both[:3]:
        print(f"        both: {key}: {JA[key]!r}")


header("C2-tight. ko — 의+noun vs 을/를+verb, adjacent only")
KO_NOUN_PHRASE = re.compile(r"의\s*(?:삭제|생성|편집|업데이트|복사|저장|설치|제거|재발급|해제|연결|추가|전송|실행)")
KO_VERB_PHRASE = re.compile(r"[을를]\s*[가-힣]{0,6}(?:합니다|해요|하세요|하기|하는|했다|했습니다)")

for label, en_pattern in VERBS.items():
    keys = [k for k, v in EN.items() if en_pattern.search(v)]
    noun_keys, verb_keys = [], []
    for key in keys:
        value = mask(KO.get(key, ""))
        if KO_NOUN_PHRASE.search(value):
            noun_keys.append(key)
        if KO_VERB_PHRASE.search(value):
            verb_keys.append(key)
    both = sorted(set(noun_keys) & set(verb_keys))
    print(
        f"  {label:8s}  {len(keys):3d} en keys | 의+noun {len(noun_keys):3d} | "
        f"을/를+verb {len(verb_keys):3d} | both {len(both):2d}"
    )
    for key in both[:3]:
        print(f"        both: {key}: {KO[key]!r}")


# ---------------------------------------------------------------------------
header("A3. ja 削除済み vs 削除された — is the split by grammatical role?")

# Role test: 済み is a pre-nominal modifier or a bare state in a coordinate list;
# された is a passive predicate. Classify every key that carries either form.
MODIFIER_FOLLOWS = re.compile(r"削除済み(?:[^\s、。]{0,6})?(?:エージェント|件|サーバー|タスク|項目|もの)")
PASSIVE_PREDICATE = re.compile(r"削除された(?:か|可能性|もの|場合|ため|の|。)")

rows = []
for key in sorted(JA):
    value = JA[key]
    if "削除済み" in value or "削除された" in value:
        rows.append(key)

for key in rows:
    value = JA[key]
    form = "削除済み" if "削除済み" in value else "削除された"
    role = []
    if MODIFIER_FOLLOWS.search(value):
        role.append("modifier")
    if PASSIVE_PREDICATE.search(value):
        role.append("passive")
    print(f"  {form:6s}  {'/'.join(role) or 'UNCLASSIFIED':11s}  {key}")
    print(f"            en: {EN.get(key)!r}")
    print(f"            ja: {value!r}")


# ---------------------------------------------------------------------------
header("A4. ja 済み overall — does every 済み key share one role?")

# The 済み convention covers ~110 keys. Sample the distinct role shapes so a
# later reader can see whether 削除済み is an outlier or the family norm.
BARE_STATE = re.compile(r"^[^。]{1,12}済み$")
AS_MODIFIER = re.compile(r"済み[^\s、。]{0,8}$")
IN_CLAUSE = re.compile(r"済み[、。はがをにでの]|済み[^\s]{0,4}(です|ます|ました)")

shapes = Counter()
for key in sorted(JA):
    value = JA[key]
    if "済み" not in value:
        continue
    if BARE_STATE.match(value):
        shapes["bare state label (…済み)"] += 1
    elif AS_MODIFIER.search(value):
        shapes["pre-nominal modifier (…済みX)"] += 1
    elif IN_CLAUSE.search(value):
        shapes["inside a clause"] += 1
    else:
        shapes["other"] += 1
for shape, count in shapes.most_common():
    print(f"  {count:4d}  {shape}")

print()
print("done.")
