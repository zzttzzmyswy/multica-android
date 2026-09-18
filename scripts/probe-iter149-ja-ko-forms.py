#!/usr/bin/env python3
"""Iteration 149 probe: measure the ja/ko conventions the 148 round never checked.

Three questions, all answered from the real bundles:

1. Parentheses. 147 settled "ja uses full-width （）, ko uses half-width ()".
   Does the bundle actually hold that, and did the 148 round's 27 edits break it?
2. Number + unit spacing. `45 秒` vs `45秒`, `5 分`, ko `45초` / `5분`.
3. Numbers and dates generally: which numeral form (half-width vs full-width)
   each locale uses, and whether the same figure is written the same way.
"""
import json
import re
import unicodedata
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

# ---------------------------------------------------------------- parentheses
HALF_PAIR = re.compile(r"\([^()]*\)")
FULL_PAIR = re.compile(r"（[^（）]*）")

print("=" * 72)
print("1. PARENTHESES")
print("=" * 72)
for name, bundle in (("ja", JA), ("ko", KO), ("zh-Hans", ZH), ("en", EN)):
    half = full = 0
    half_keys, full_keys = [], []
    for key, value in bundle.items():
        h = HALF_PAIR.findall(value)
        f = FULL_PAIR.findall(value)
        if h:
            half += len(h)
            half_keys.append((key, h))
        if f:
            full += len(f)
            full_keys.append((key, f))
    print(f"\n{name}: half-width () {half} occurrences in {len(half_keys)} keys; "
          f"full-width （） {full} in {len(full_keys)} keys")
    if name == "ja" and half_keys:
        print("  ja half-width pairs (should be empty if the convention holds):")
        for key, pairs in half_keys:
            print(f"    {key}: {pairs}  <- {bundle[key]!r}")
    if name == "ko" and full_keys:
        print("  ko full-width pairs (should be empty if the convention holds):")
        for key, pairs in full_keys:
            print(f"    {key}: {pairs}  <- {bundle[key]!r}")

# ------------------------------------------------------------------- numerals
print()
print("=" * 72)
print("2. NUMERAL FORM")
print("=" * 72)
FULLWIDTH_DIGIT = re.compile(r"[０-９]")
for name, bundle in (("ja", JA), ("ko", KO), ("en", EN)):
    hits = [(k, v) for k, v in bundle.items() if FULLWIDTH_DIGIT.search(v)]
    print(f"{name}: full-width digits in {len(hits)} keys")
    for k, v in hits[:10]:
        print(f"    {k}: {v!r}")

# --------------------------------------------------------------- number+unit
print()
print("=" * 72)
print("3. NUMBER + UNIT SPACING")
print("=" * 72)
# A digit run, then optional space, then a unit token.
UNIT = r"(秒|分|時間|日|週間|か月|ヶ月|年|件|個|名|回|초|분|시간|일|주|개월|년|건|개|명|번)"
SPACED = re.compile(r"\d\s+" + UNIT)
UNSPACED = re.compile(r"\d" + UNIT)
for name, bundle in (("ja", JA), ("ko", KO)):
    spaced = [(k, v) for k, v in bundle.items() if SPACED.search(v)]
    unspaced = [(k, v) for k, v in bundle.items() if UNSPACED.search(v)]
    print(f"\n{name}: {len(spaced)} keys with a SPACE before the unit, "
          f"{len(unspaced)} keys with NO space")
    print(f"  -- spaced ({name}) --")
    for k, v in spaced:
        print(f"    {k}: {v!r}")
    print(f"  -- unspaced ({name}) --")
    for k, v in unspaced:
        print(f"    {k}: {v!r}")

# ------------------------------------------------------- same figure, two ways
print()
print("=" * 72)
print("4. UNIT PAIRWISE CONFLICT (same unit, both spellings present)")
print("=" * 72)
for name, bundle in (("ja", JA), ("ko", KO)):
    by_unit = defaultdict(lambda: {"spaced": [], "unspaced": []})
    for key, value in bundle.items():
        for m in SPACED.finditer(value):
            by_unit[m.group(1)]["spaced"].append((key, value))
        for m in UNSPACED.finditer(value):
            by_unit[m.group(1)]["unspaced"].append((key, value))
    for unit, groups in sorted(by_unit.items()):
        if groups["spaced"] and groups["unspaced"]:
            print(f"{name} unit {unit!r}: BOTH forms present")
            for k, v in groups["spaced"]:
                print(f"    spaced   {k}: {v!r}")
            for k, v in groups["unspaced"]:
                print(f"    unspaced {k}: {v!r}")

# --------------------------------------------------- latin term adjacency
print()
print("=" * 72)
print("5. LATIN ADJACENT TO NATIVE (word-combination rule for ja/ko)")
print("=" * 72)
for name, bundle in (("ja", JA), ("ko", KO)):
    tight = []
    for key, value in bundle.items():
        # Latin letter immediately followed/preceded by a CJK/kana/hangul char
        if re.search(r"[A-Za-z][぀-ヿ一-鿿가-힣]", value) or re.search(
            r"[぀-ヿ一-鿿가-힣][A-Za-z]", value
        ):
            tight.append((key, value))
    print(f"{name}: {len(tight)} keys with no space between Latin and native")
    for k, v in tight[:40]:
        print(f"    {k}: {v!r}")
