#!/usr/bin/env python3
"""Iteration 149 probe 2: is there a *partition* behind each ja split?

Probe 1 found three ja splits the 147/148 rounds never measured:
  - parentheses: 66 full-width vs 19 half-width
  - number + unit: 25 spaced vs 9 unspaced
and one clean ko result (0 spaced vs 34 unspaced).

A split is only settled by "clear majority" or by "clean partition". This probe
looks for a partition in each: by namespace, by surface, by what sits inside the
parentheses, by whether the figure is a literal or an interpolation.
"""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

LOCALES = Path(__file__).resolve().parent.parent / "packages/views/locales"


def flatten(value, prefix=""):
    if value is None or not isinstance(value, (dict, list)):
        return {prefix: str(value)}
    if isinstance(value, list):
        out = {}
        for i, child in enumerate(value):
            out.update(flatten(child, f"{prefix}.{i}" if prefix else str(i)))
        return out
    out = {}
    for key, child in value.items():
        out.update(flatten(child, f"{prefix}.{key}" if prefix else key))
    return out


def load(locale):
    bundle = {}
    for path in sorted((LOCALES / locale).glob("*.json")):
        ns = path.stem
        for key, value in flatten(json.loads(path.read_text(encoding="utf-8"))).items():
            bundle[f"{ns}.{key}"] = value
    return bundle


EN = load("en")
JA = load("ja")
KO = load("ko")
ZH = load("zh-Hans")

HALF_PAIR = re.compile(r"\(([^()]*)\)")
FULL_PAIR = re.compile(r"（([^（）]*)）")
LATIN = re.compile(r"[A-Za-z]")
PLACEHOLDER = re.compile(r"\{\{")


def classify(content):
    has_latin = bool(LATIN.search(content))
    has_ph = bool(PLACEHOLDER.search(content))
    if has_ph and not has_latin:
        return "placeholder only"
    if has_latin:
        return "contains Latin"
    return "native only"


print("=" * 74)
print("A. ja PARENTHESES — is the 66 full / 19 half split a partition?")
print("=" * 74)
rows = []
for key, value in JA.items():
    for content in HALF_PAIR.findall(value):
        rows.append(("half", key, content, classify(content)))
    for content in FULL_PAIR.findall(value):
        rows.append(("full", key, content, classify(content)))

by_form = defaultdict(Counter)
for form, key, content, kind in rows:
    by_form[form][kind] += 1
    by_form[form]["ns:" + key.split(".")[0]] += 1
for form in ("half", "full"):
    print(f"\n{form}-width, by content kind: {dict((k, v) for k, v in by_form[form].items() if not k.startswith('ns:'))}")
print("\n-- content-kind cross-tab (a partition would put each kind in one form) --")
for kind in ("placeholder only", "contains Latin", "native only"):
    h = sum(1 for f, k, c, kd in rows if f == "half" and kd == kind)
    fu = sum(1 for f, k, c, kd in rows if f == "full" and kd == kind)
    print(f"  {kind:18} half={h:3}  full={fu:3}")

print("\n-- the 19 ja half-width sites in full --")
for form, key, content, kind in rows:
    if form == "half":
        print(f"  {key}\n      ja: {JA[key]!r}\n      en: {EN.get(key)!r}")

print("\n-- a sample of ja full-width sites, for contrast --")
full_keys = sorted({key for form, key, _, _ in rows if form == "full"})
for key in full_keys[:12]:
    print(f"  {key}\n      ja: {JA[key]!r}")

print()
print("=" * 74)
print("B. NUMBER + UNIT — ja 25 spaced / 9 unspaced; ko 0 / 34")
print("=" * 74)
UNIT = r"(秒|分|時間|日|週間|か月|ヶ月|年|件|個|名|回|초|분|시간|일|주|개월|년|건|개|명|번)"
SPACED = re.compile(r"(\d)\s+" + UNIT)
UNSPACED = re.compile(r"(\d)" + UNIT)

print("\n-- zh-Hans reference (does zh space a figure from its unit?) --")
ZUNIT = r"(秒|分钟|分|小时|时间|天|日|周|个月|年|件|个|名|次|位|条)"
z_sp = [(k, v) for k, v in ZH.items() if re.search(r"\d\s+" + ZUNIT, v)]
z_un = [(k, v) for k, v in ZH.items() if re.search(r"\d" + ZUNIT, v)]
print(f"  zh spaced: {len(z_sp)}   zh unspaced: {len(z_un)}")
for k, v in z_sp:
    print(f"    spaced   {k}: {v!r}")
for k, v in z_un:
    print(f"    unspaced {k}: {v!r}")

print("\n-- ja: cross-tab by namespace --")
ns_tab = defaultdict(lambda: [0, 0])
for key, value in JA.items():
    if SPACED.search(value):
        ns_tab[key.split(".")[0]][0] += 1
    if UNSPACED.search(value):
        ns_tab[key.split(".")[0]][1] += 1
for ns in sorted(ns_tab):
    sp, un = ns_tab[ns]
    flag = "  <-- BOTH FORMS" if sp and un else ""
    print(f"  {ns:12} spaced={sp:2} unspaced={un:2}{flag}")

print("\n-- ja: the same key shape in two namespaces (the sharpest evidence) --")
pairs = [
    ("autopilots.relative_date.one_day_ago", "projects.relative_date.one_day_ago"),
    ("usage.weekly.partial_label", "runtimes.usage.weekly_partial_label"),
    ("usage.duration.less_than_minute", "autopilots.schedule_editor.countdown.less_than_minute"),
]
for a, b in pairs:
    print(f"  {a}\n      {JA.get(a)!r}   (en: {EN.get(a)!r})")
    print(f"  {b}\n      {JA.get(b)!r}   (en: {EN.get(b)!r})")

print()
print("=" * 74)
print("C. PRIVATE — what each surface actually renders")
print("=" * 74)
PRIV = re.compile(r"(?<![A-Za-z])private(?![A-Za-z])", re.I)
for key in sorted(EN):
    if not PRIV.search(EN[key] or ""):
        continue
    print(f"  {key}")
    print(f"      en: {EN[key]!r}")
    print(f"      ja: {JA.get(key)!r}")
    print(f"      ko: {KO.get(key)!r}")
