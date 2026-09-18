#!/usr/bin/env python3
"""Iteration 150, item 3 angle B — ko counter *choice* (149 measured spacing only).

The first attempt masked `{{...}}` before scanning, which deleted the very
placeholders it was counting. This pass masks only backticks and the named
literals, so placeholders survive.

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

KO_COUNTERS = {
    "개", "명", "건", "가지", "번", "회", "일", "초", "분", "시간", "주", "달",
    "개월", "년", "자리", "종", "편", "줄", "페이지", "회차", "곳", "대", "번째",
}
JA_COUNTERS = {
    "件", "個", "名", "人", "本", "枚", "台", "回", "度", "行", "文字", "ページ",
    "階", "時", "泊", "杯", "冊", "秒", "分", "時間", "日", "日間", "週間", "週",
    "か月", "ヶ月", "年", "つ", "点", "種", "箇所", "番目",
}

FIGURE = r"(?:\d+|\{\{[^}]*\}\})"


def measure(label, bundle, counters, nouns):
    print(f"\n  {label}")
    for noun_label, en_pattern in nouns.items():
        after = re.compile(FIGURE + r"\s*([가-힣]{1,3})" if counters is KO_COUNTERS else FIGURE + r"\s*([^\s、。]{1,3})")
        tally = Counter()
        examples = defaultdict(list)
        for key, en_value in sorted(EN.items()):
            if not en_pattern.search(en_value):
                continue
            for counter in after.findall(mask(bundle.get(key, ""))):
                if counter in counters:
                    tally[counter] += 1
                    examples[counter].append((key, bundle[key]))
        if not tally:
            continue
        parts = ", ".join(f"{c}×{n}" for c, n in tally.most_common())
        flag = "  <-- SPLIT" if len(tally) > 1 else ""
        print(f"      {noun_label:22s} {parts}{flag}")
        if len(tally) > 1:
            for counter in tally:
                for key, value in examples[counter][:2]:
                    print(f"          {counter}: {key}: {value!r}")


NOUNS = {
    "agent(s)": re.compile(r"\bagents?\b", re.I),
    "issue(s)": re.compile(r"\bissues?\b", re.I),
    "task(s)": re.compile(r"\btasks?\b", re.I),
    "member(s)": re.compile(r"\bmembers?\b", re.I),
    "skill(s)": re.compile(r"\bskills?\b", re.I),
    "file(s)": re.compile(r"\bfiles?\b", re.I),
    "comment(s)": re.compile(r"\bcomments?\b", re.I),
    "run(s)": re.compile(r"\bruns?\b", re.I),
    "repo(s)": re.compile(r"\b(repos?|repositor(y|ies))\b", re.I),
    "filter(s)": re.compile(r"\bfilters?\b", re.I),
    "step(s)": re.compile(r"\bsteps?\b", re.I),
    "tool(s)": re.compile(r"\btools?\b", re.I),
    "model(s)": re.compile(r"\bmodels?\b", re.I),
    "variable(s)": re.compile(r"\bvariables?\b", re.I),
    "selected": re.compile(r"\bselected\b", re.I),
    "queued": re.compile(r"\bqueued\b", re.I),
    "running": re.compile(r"\brunning\b", re.I),
    "unread": re.compile(r"\bunread\b", re.I),
    "match(es)": re.compile(r"\bmatches?\b", re.I),
}

print("=" * 78)
print("ko counter choice, grouped by English noun")
print("=" * 78)
measure("ko", KO, KO_COUNTERS, NOUNS)

print()
print("=" * 78)
print("ja counter choice, grouped by English noun (contrast)")
print("=" * 78)
measure("ja", JA, JA_COUNTERS, NOUNS)

print()
print("=" * 78)
print("ko: every distinct counter in the bundle, with its keys")
print("=" * 78)
tally = Counter()
examples = defaultdict(list)
after = re.compile(FIGURE + r"\s*([가-힣]{1,3})")
for key in sorted(KO):
    for counter in after.findall(mask(KO[key])):
        if counter in KO_COUNTERS:
            tally[counter] += 1
            examples[counter].append(key)
for counter, count in tally.most_common():
    print(f"  {counter:5s} {count:3d}   e.g. {', '.join(examples[counter][:3])}")

print()
print("done.")
