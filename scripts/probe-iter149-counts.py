#!/usr/bin/env python3
"""Iteration 149 probe 3: occurrence-level counts and the Private label keys.

Probe 2 counted *keys*. A key can carry several figures, so the majority tally
has to be counted per occurrence before it can settle anything. This probe also
answers two questions probe 2 raised:

  - `settings.plugins.private` vs `settings.repositories.github_private` — the
    148 round cited them as two labels rendering the Private concept with two
    different ja words. Do those keys exist, and what do they render?
  - Does the SCREAMING_SNAKE mask in ja-ko-unlisted-terms.test.ts hide a real
    Latin outlier? (Candidate 4.)
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


EN, JA, KO, ZH = (load(x) for x in ("en", "ja", "ko", "zh-Hans"))

# ------------------------------------------------------- number + unit, by hit
JA_UNITS = r"秒|分|時間|日間|日中|日目|日|週間|週|か月|ヶ月|年|件|個|名|回|つ|人|本|枚"
KO_UNITS = r"초|분|시간|일|주|개월|년|건|개|명|번|가지|회|달"

SPACED_JA = re.compile(rf"\d\s+(?:{JA_UNITS})")
TIGHT_JA = re.compile(rf"\d(?:{JA_UNITS})")
SPACED_KO = re.compile(rf"\d\s+(?:{KO_UNITS})")
TIGHT_KO = re.compile(rf"\d(?:{KO_UNITS})")

print("=" * 74)
print("A. NUMBER + UNIT, counted per OCCURRENCE")
print("=" * 74)
for name, bundle, sp, ti in (
    ("ja", JA, SPACED_JA, TIGHT_JA),
    ("ko", KO, SPACED_KO, TIGHT_KO),
    ("zh-Hans", ZH, re.compile(r"\d\s+(?:秒|分钟|分|小时|时间|天|日|周|个月|年|件|个|名|次|位|条)"),
     re.compile(r"\d(?:秒|分钟|分|小时|时间|天|日|周|个月|年|件|个|名|次|位|条)")),
):
    n_sp = sum(len(sp.findall(v)) for v in bundle.values())
    n_ti = sum(len(ti.findall(v)) for v in bundle.values())
    print(f"{name:8} spaced occurrences={n_sp:3}  tight occurrences={n_ti:3}")

print("\n-- ja: every spaced occurrence --")
for key in sorted(JA):
    for m in SPACED_JA.finditer(JA[key]):
        print(f"  {key}: {m.group(0)!r}   <- {JA[key]!r}")
print("\n-- ja: every tight occurrence --")
for key in sorted(JA):
    for m in TIGHT_JA.finditer(JA[key]):
        print(f"  {key}: {m.group(0)!r}   <- {JA[key]!r}")

print()
print("=" * 74)
print("B. PRIVATE — the two label keys 148 cited")
print("=" * 74)
for needle in ("plugins", "github_private", "repositories"):
    print(f"\n-- keys matching {needle!r} --")
    for key in sorted(EN):
        if needle in key:
            print(f"  {key}")
            print(f"      en: {EN[key]!r}")
            print(f"      ja: {JA.get(key)!r}")
            print(f"      ko: {KO.get(key)!r}")

print("\n-- every key whose ja value contains プライベート or 非公開 --")
for word in ("プライベート", "非公開"):
    print(f"\n  == {word} ==")
    for key in sorted(JA):
        if word in JA[key]:
            print(f"    {key}: {JA[key]!r}")

print()
print("=" * 74)
print("C. SCREAMING_SNAKE mask — does it hide a real Latin outlier?")
print("=" * 74)
MASKED = [
    (r"SKILL\.md", "SKILL.md"),
    (r"Skills\.sh", "Skills.sh"),
    (r"skill-name", "skill-name"),
    (r"@squad", "@squad"),
    (r"Agent Builder", "Agent Builder"),
    (r"agent/…", "agent/…"),
    (r"my-workspace", "my-workspace"),
    (r"\{\{[^}]*\}\}", "{{...}}"),
    (r"`[^`]*`", "`...`"),
    (r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b", "SCREAMING_SNAKE"),
]
TERMS = {
    "instance": r"(?<![A-Za-z])instances?(?![A-Za-z])",
    "desktop": r"(?<![A-Za-z])desktop(?![A-Za-z])",
    "provider": r"(?<![A-Za-z])providers?(?![A-Za-z])",
    "batch": r"(?<![A-Za-z])batches?(?![A-Za-z])",
    "heartbeat": r"(?<![A-Za-z])heartbeats?(?![A-Za-z])",
    "tier": r"(?<![A-Za-z])tiers?(?![A-Za-z])",
    "private": r"(?<![A-Za-z])private(?![A-Za-z])",
    "pull request": r"(?<![A-Za-z])pull requests?(?![A-Za-z])",
}


def mask(value):
    out = value
    for pattern, _ in MASKED:
        out = re.sub(pattern, "…", out)
    return out


hidden = []
for locale, bundle in (("ja", JA), ("ko", KO)):
    for key, value in bundle.items():
        unmasked = value
        masked = mask(value)
        for label, pattern in TERMS.items():
            rx = re.compile(pattern, re.I)
            if rx.search(unmasked) and not rx.search(masked):
                # the only reason it vanished is a mask
                hidden.append((locale, label, key, value, masked))
if hidden:
    print("MASK HIDES these term hits:")
    for locale, label, key, value, masked in hidden:
        print(f"  {locale} {label} {key}\n      raw:    {value!r}\n      masked: {masked!r}")
else:
    print("no term hit in either bundle disappears because of the mask")

print("\n-- what the SCREAMING_SNAKE pattern actually matches in both bundles --")
for locale, bundle in (("ja", JA), ("ko", KO)):
    hits = Counter()
    for value in bundle.values():
        for m in re.finditer(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b", value):
            hits[m.group(0)] += 1
    print(f"  {locale}: {dict(hits)}")
print("\n-- standalone all-caps tokens (API / CLI / URL ...) the mask does NOT touch --")
for locale, bundle in (("ja", JA), ("ko", KO)):
    hits = Counter()
    for value in bundle.values():
        for m in re.finditer(r"\b[A-Z]{2,}\b", value):
            if not re.search(rf"\b{m.group(0)}(?:_[A-Z0-9]+)+\b", value):
                hits[m.group(0)] += 1
    print(f"  {locale}: {dict(hits)}")
