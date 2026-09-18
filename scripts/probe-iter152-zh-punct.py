#!/usr/bin/env python3
"""Round 152, item 2 — classify the zh punctuation surfaces round 151 left measured
but unclassified.

151 converged three classes (quotes, `，；`, brackets) and left three measured:

  - `—` / `–`  (views 207 / 89, mobile 3 / 1)
  - `·`        (views 73 / 28)
  - full-width `！` / `？` usage (whether they should be `。`, whether doubled)

The discipline is the same one every round uses: a class may be pinned only when
it has zero exceptions; a genuine fork goes to the ledger instead of being
silently converged.

This script prints the raw evidence — every key and value — so the classification
is read off the bundle rather than assumed. It measures BOTH zh bundles.
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEWS = os.path.join(REPO, "packages/views/locales/zh-Hans")
MOBILE = os.path.join(REPO, "apps/mobile/lib/i18n/locales/zh.json")
EN_VIEWS = os.path.join(REPO, "packages/views/locales/en")
EN_MOBILE = os.path.join(REPO, "apps/mobile/lib/i18n/locales/en.json")

HAN = re.compile(r"\p{Script=Han}", re.UNICODE) if False else re.compile(
    "[㐀-䶿一-鿿豈-﫿]"
)


def flatten(value, prefix=""):
    if not isinstance(value, dict):
        return {prefix: str(value)}
    out = {}
    for k, v in value.items():
        out.update(flatten(v, f"{prefix}.{k}" if prefix else k))
    return out


def load_views(locale_dir):
    bundle = {}
    for name in sorted(os.listdir(locale_dir)):
        if not name.endswith(".json"):
            continue
        ns = name[: -len(".json")]
        with open(os.path.join(locale_dir, name), encoding="utf-8") as fh:
            for k, v in flatten(json.load(fh)).items():
                bundle[f"{ns}.{k}"] = v
    return bundle


def load_mobile(path):
    with open(path, encoding="utf-8") as fh:
        return flatten(json.load(fh))


VIEWS_ZH = load_views(VIEWS)
MOBILE_ZH = load_mobile(MOBILE)
VIEWS_EN = load_views(EN_VIEWS)
MOBILE_EN = load_mobile(EN_MOBILE)

BUNDLES = [("views zh-Hans", VIEWS_ZH, VIEWS_EN), ("mobile zh", MOBILE_ZH, MOBILE_EN)]


def section(title):
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


def show(bundle, pattern, en_bundle, limit=None, note=""):
    rows = [(k, v) for k, v in bundle.items() if pattern.search(v)]
    print(f"  {len(rows)} keys  {note}")
    for k, v in rows[: limit or len(rows)]:
        en = en_bundle.get(k, "<no en>")
        print(f"    {k}")
        print(f"      zh: {v!r}")
        print(f"      en: {en!r}")
    if limit and len(rows) > limit:
        print(f"    ... {len(rows) - limit} more")
    return rows


# --------------------------------------------------------------------------
section("A. em dash `—` (U+2014) and en dash `–` (U+2013)")
for name, zh, en in BUNDLES:
    for ch, label in [("—", "em dash —"), ("–", "en dash –")]:
        rows = [(k, v) for k, v in zh.items() if ch in v]
        occ = sum(v.count(ch) for _, v in rows)
        print(f"\n  [{name}] {label}: {len(rows)} keys / {occ} occurrences")
        # classify: how does the dash sit? surrounded by spaces vs not
        shapes = Counter()
        for k, v in rows:
            for m in re.finditer(re.escape(ch), v):
                before = v[m.start() - 1] if m.start() else ""
                after = v[m.end()] if m.end() < len(v) else ""
                shapes[(before == " ", after == " ")] += 1
        for shape, n in sorted(shapes.items()):
            print(f"      spaced both sides={shape[0]} and={shape[1]}: {n}")

section("A2. every em-dash key, with its English source, grouped by English shape")
for name, zh, en in BUNDLES:
    print(f"\n--- {name} ---")
    groups = defaultdict(list)
    for k, v in zh.items():
        if "—" not in v:
            continue
        e = en.get(k, "<no en>")
        if " — " in v and " — " in e:
            groups["en has ` — ` too"].append((k, v, e))
        elif " — " in v:
            groups["zh spaced, en does not"].append((k, v, e))
        elif "—" in e:
            groups["en has a dash, zh's is unspaced"].append((k, v, e))
        else:
            groups["neither en nor zh spaced"].append((k, v, e))
    for g, rows in sorted(groups.items()):
        print(f"  [{g}] {len(rows)} keys")
        for k, v, e in rows:
            print(f"      {k}")
            print(f"        zh: {v!r}")
            print(f"        en: {e!r}")

# --------------------------------------------------------------------------
section("B. middle dot `·` (U+00B7) — and the katakana middle dot U+30FB for contrast")
for name, zh, en in BUNDLES:
    for ch, label in [("·", "· U+00B7"), ("・", "・ U+30FB")]:
        rows = [(k, v) for k, v in zh.items() if ch in v]
        occ = sum(v.count(ch) for _, v in rows)
        print(f"\n  [{name}] {label}: {len(rows)} keys / {occ} occurrences")
        en_with = sum(1 for k, _ in rows if ch in en.get(k, ""))
        print(f"      English source carries the same char on {en_with} of them")

section("B2. every `·` key with its English source")
for name, zh, en in BUNDLES:
    print(f"\n--- {name} ---")
    for k, v in sorted(zh.items()):
        if "·" not in v:
            continue
        print(f"    {k}")
        print(f"      zh: {v!r}")
        print(f"      en: {en.get(k, '<no en>')!r}")

# --------------------------------------------------------------------------
section("C. full-width `！` and `？`")
for name, zh, en in BUNDLES:
    for ch, label in [("！", "！ full-width"), ("？", "？ full-width"),
                      ("!", "! half-width"), ("?", "? half-width")]:
        rows = [(k, v) for k, v in zh.items() if ch in v]
        print(f"  [{name}] {label}: {len(rows)} keys / {sum(v.count(ch) for _, v in rows)} occurrences")

section("C2. full-width ！/？ keys, classified: Han copy vs not, en shape")
for name, zh, en in BUNDLES:
    print(f"\n--- {name} ---")
    for k, v in sorted(zh.items()):
        if "！" not in v and "？" not in v:
            continue
        e = en.get(k, "<no en>")
        has_han = bool(HAN.search(v))
        # doubled punctuation, e.g. ！！ or ？！
        doubled = bool(re.search(r"[！？]{2}", v))
        print(f"    {k}")
        print(f"      zh: {v!r}   han={has_han} doubled={doubled}")
        print(f"      en: {e!r}")

section("C3. values that END in ！ or ？ (sentence-final usage)")
for name, zh, en in BUNDLES:
    rows = [(k, v) for k, v in zh.items() if v.rstrip().endswith(("！", "？"))]
    print(f"\n  [{name}] {len(rows)} keys end with ！/？")
    for k, v in rows:
        print(f"    {k}: {v!r}")
        print(f"      en: {en.get(k, '<no en>')!r}")

section("C4. mixed: a value with BOTH 。 and ！/？ (the `should be 。` hypothesis)")
for name, zh, en in BUNDLES:
    rows = [
        (k, v)
        for k, v in zh.items()
        if ("！" in v or "？" in v) and "。" in v
    ]
    print(f"\n  [{name}] {len(rows)} keys carry both 。 and ！/？")
    for k, v in rows:
        print(f"    {k}: {v!r}")
        print(f"      en: {en.get(k, '<no en>')!r}")

section("C5. `！`/`？` inside a value that also contains a placeholder (sentence built around it)")
for name, zh, en in BUNDLES:
    rows = [
        (k, v)
        for k, v in zh.items()
        if ("！" in v or "？" in v) and "{{" in v
    ]
    print(f"\n  [{name}] {len(rows)} keys")
    for k, v in rows:
        print(f"    {k}: {v!r}")
        print(f"      en: {en.get(k, '<no en>')!r}")
