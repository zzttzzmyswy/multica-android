#!/usr/bin/env python3
"""Iteration 150 — candidate guard detectors, checked for false positives first.

A guard that fires on correct prose is worse than no guard (149 hit this with the
`every -> some` false red). Every detector below is run against the current
bundles; the printed hit counts are the false-positive count, and each must be 0
before it is allowed into a test.

Also measures the ko counter *choice* (149 measured only spacing).

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


def scan(name, bundle, pattern):
    hits = [k for k in sorted(bundle) if pattern.search(mask(bundle[k]))]
    print(f"  {name}: {len(hits)} hits")
    for key in hits[:6]:
        print(f"      {key}: {bundle[key]!r}")
    return hits


# ---------------------------------------------------------------------------
header("D1. detector FP check — ko `됨` used as a sentence predicate")
# If 0, the detector is safe to assert.
scan("됨 + sentence-final ending", KO, re.compile(r"됨\s*(습니다|했다|한다|해요|입니다|하였다)"))
scan("됨 + 하/되 continuation", KO, re.compile(r"됨\s*(하여|해서|하고|하며|하지)"))

header("D2. detector FP check — ja `済み` used as a passive predicate")
scan("済み + 可能性", JA, re.compile(r"済み[^、。]{0,4}可能性"))
scan("済み + passive auxiliary", JA, re.compile(r"済み\s*(ました|ません|ます)"))

header("D3. detector FP check — ko `된/되었` used as a bare terminal label")
# The converse claim: a *bare* label (whole value is just X됨/X된, nothing else)
# must take 됨, not 된.
bare = re.compile(r"^[\w\s{}…가-힣]*?(됨|된|되었)$")
hits_doen = [k for k in sorted(KO) if re.fullmatch(r"[^ ]{1,12}된", mask(KO[k]).strip())]
hits_doem = [k for k in sorted(KO) if re.fullmatch(r"[^ ]{1,12}됨", mask(KO[k]).strip())]
print(f"  bare value ending in 된 (no 됨): {len(hits_doen)}")
for key in hits_doen[:8]:
    print(f"      {key}: {KO[key]!r}   <- en {EN.get(key)!r}")
print(f"  bare value ending in 됨: {len(hits_doem)}")
for key in hits_doem[:8]:
    print(f"      {key}: {KO[key]!r}   <- en {EN.get(key)!r}")

header("D4. detector FP check — ja bare label ending in 済み vs された")
ja_shimi = [k for k in sorted(JA) if re.fullmatch(r"[^ ]{1,12}済み", mask(JA[k]).strip())]
ja_sareta = [k for k in sorted(JA) if re.fullmatch(r"[^ ]{1,12}された", mask(JA[k]).strip())]
print(f"  bare value ending in 済み: {len(ja_shimi)}")
print(f"  bare value ending in された: {len(ja_sareta)}")
for key in ja_sareta[:8]:
    print(f"      {key}: {JA[key]!r}   <- en {EN.get(key)!r}")

header("D5. the state-form families, counted")
print(f"  ja keys containing 済み: {sum(1 for k in JA if '済み' in JA[k])}")
print(f"  ja keys containing された: {sum(1 for k in JA if 'された' in JA[k])}")
print(f"  ko keys containing 됨: {sum(1 for k in KO if '됨' in KO[k])}")
print(f"  ko keys containing 된/되었: {sum(1 for k in KO if '된' in KO[k] or '되었' in KO[k])}")


# ---------------------------------------------------------------------------
header("B3. ko counter choice — literal and placeholder, by English noun")

# For each English source, find the ko counter that follows a figure (literal or
# placeholder). This is the *choice* 149 never read.
COUNTER_AFTER = re.compile(r"(?:\d+|\{\{[^}]*\}\})\s*([가-힣]{1,3})")
KO_COUNTERS = {
    "개", "명", "건", "가지", "번", "회", "일", "초", "분", "시간", "주", "달",
    "개월", "년", "자리", "종", "편", "줄", "페이지", "회차", "곳", "대",
}

NOUNS = {
    "agent(s)": re.compile(r"\bagents?\b", re.I),
    "issue(s)": re.compile(r"\bissues?\b", re.I),
    "task(s)": re.compile(r"\btasks?\b", re.I),
    "member(s)": re.compile(r"\bmembers?\b", re.I),
    "skill(s)": re.compile(r"\bskills?\b", re.I),
    "file(s)": re.compile(r"\bfiles?\b", re.I),
    "comment(s)": re.compile(r"\bcomments?\b", re.I),
    "run(s)": re.compile(r"\bruns?\b", re.I),
    "repo(s)/repository": re.compile(r"\b(repos?|repositor(y|ies))\b", re.I),
    "filter(s)": re.compile(r"\bfilters?\b", re.I),
    "step(s)": re.compile(r"\bsteps?\b", re.I),
    "tool(s)": re.compile(r"\btools?\b", re.I),
    "model(s)": re.compile(r"\bmodels?\b", re.I),
    "variable(s)": re.compile(r"\bvariables?\b", re.I),
}

for label, en_pattern in NOUNS.items():
    tally = Counter()
    examples = defaultdict(list)
    for key, en_value in sorted(EN.items()):
        if not en_pattern.search(en_value):
            continue
        for counter in COUNTER_AFTER.findall(mask(KO.get(key, ""))):
            if counter in KO_COUNTERS:
                tally[counter] += 1
                examples[counter].append((key, KO[key]))
    if not tally:
        continue
    print(f"\n  {label}")
    for counter, count in tally.most_common():
        keys = ", ".join(k for k, _ in examples[counter][:2])
        print(f"      {count:3d}  {counter:4s}   e.g. {keys}")
    if len(tally) > 1:
        print("      ^ MULTIPLE COUNTERS for one English noun")

header("B4. ja counter choice — same grouping, for contrast")
JA_COUNTERS = {
    "件", "個", "名", "人", "本", "枚", "台", "回", "度", "行", "文字",
    "ページ", "階", "時", "泊", "杯", "冊", "秒", "分", "時間", "日", "日間",
    "週間", "週", "か月", "ヶ月", "年", "つ", "点", "種", "箇所",
}
for label, en_pattern in NOUNS.items():
    tally = Counter()
    examples = defaultdict(list)
    for key, en_value in sorted(EN.items()):
        if not en_pattern.search(en_value):
            continue
        for counter in COUNTER_AFTER.findall(mask(JA.get(key, ""))):
            if counter in JA_COUNTERS:
                tally[counter] += 1
                examples[counter].append((key, JA[key]))
    if not tally:
        continue
    print(f"\n  {label}")
    for counter, count in tally.most_common():
        keys = ", ".join(k for k, _ in examples[counter][:2])
        print(f"      {count:3d}  {counter:4s}   e.g. {keys}")

print()
print("done.")
