#!/usr/bin/env python3
"""Round 152, item 2 — the classification pass.

Round 151 measured three zh punctuation surfaces and classified none of them.
The probe (`probe-iter152-zh-punct.py`) dumps the raw evidence; this script turns
it into the three verdicts the round has to reach, each as a *claim with a
counter* so the answer is a number and not an impression:

  1. Full-width `！？` — the 151 round pinned that no half-width `!` or `?`
     survives. That is half a rule. The other half is whether the full-width mark
     tracks the English source or is used for effect (an exclamation where the
     English has a full stop, a doubled mark, and so on). Claim: the mark is a
     faithful transcription of the English terminal mark. Zero exceptions would
     make it pinnable.

  2. `·` — 68 views keys and 25 mobile keys carry it. Claim: it is carried over
     from the English source verbatim, never introduced by the translation. The
     counter here is the number of keys where zh has `·` and English does not.

  3. `—` — a dash. Chinese uses the doubled `——`; the English source uses a
     spaced single ` — `. Claim: the bundles agree on one of them. The counter is
     the cross-tab; if both forms are in use on the *same kind of string*, the
     class is a fork and belongs in the ledger, not in a guard.

Run from the repo root. Prints a verdict per class.
"""

import json
import os
import re
from collections import Counter, defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEWS = os.path.join(REPO, "packages/views/locales")
MOBILE = os.path.join(REPO, "apps/mobile/lib/i18n/locales")

HAN = re.compile("[㐀-䶿一-鿿豈-﫿]")


def flatten(value, prefix=""):
    if not isinstance(value, dict):
        return {prefix: str(value)}
    out = {}
    for k, v in value.items():
        out.update(flatten(v, f"{prefix}.{k}" if prefix else k))
    return out


def load_views(locale):
    bundle = {}
    d = os.path.join(VIEWS, locale)
    for name in sorted(os.listdir(d)):
        if name.endswith(".json"):
            with open(os.path.join(d, name), encoding="utf-8") as fh:
                for k, v in flatten(json.load(fh)).items():
                    bundle[f"{name[:-5]}.{k}"] = v
    return bundle


def load_mobile(locale):
    with open(os.path.join(MOBILE, f"{locale}.json"), encoding="utf-8") as fh:
        return flatten(json.load(fh))


BUNDLES = [
    ("views zh-Hans", load_views("zh-Hans"), load_views("en")),
    ("mobile zh", load_mobile("zh"), load_mobile("en")),
]

verdicts = []


def head(title):
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


# ---------------------------------------------------------------------------
head("1. full-width ！/？ — does the mark track the English terminal mark?")

for name, zh, en in BUNDLES:
    print(f"\n--- {name} ---")
    for mark, latin in [("！", "!"), ("？", "?")]:
        zh_keys = [k for k, v in zh.items() if mark in v]
        no_en = [k for k in zh_keys if latin not in en.get(k, "")]
        print(f"  {mark}: {len(zh_keys)} keys; English has no `{latin}` on {len(no_en)} of them")
        for k in no_en:
            print(f"      MISMATCH {k}\n        zh: {zh[k]!r}\n        en: {en.get(k)!r}")
        # the reverse: English has the mark, zh does not
        en_keys = [k for k, v in en.items() if latin in v]
        zh_missing = [k for k in en_keys if mark not in zh.get(k, "")]
        print(f"      reverse: English has `{latin}` on {len(en_keys)} keys; "
              f"zh lacks {mark} on {len(zh_missing)}")
        for k in zh_missing[:12]:
            print(f"      (zh uses another mark) {k}\n        zh: {zh.get(k)!r}\n        en: {en[k]!r}")
        if len(zh_missing) > 12:
            print(f"      ... {len(zh_missing) - 12} more")

head("1b. doubled or stacked ！？")
for name, zh, en in BUNDLES:
    hits = [(k, v) for k, v in zh.items() if re.search(r"[！？]{2,}", v)]
    print(f"  [{name}] {len(hits)} keys carry a doubled mark")
    for k, v in hits:
        print(f"    {k}: {v!r}\n      en: {en.get(k)!r}")

head("1c. full-width mark at a position where English has no mark at all")
for name, zh, en in BUNDLES:
    hits = []
    for k, v in zh.items():
        for m in re.finditer(r"[！？]", v):
            # the English must have *some* terminal mark to correspond to
            if not re.search(r"[!?]", en.get(k, "")):
                hits.append((k, v, en.get(k)))
                break
    print(f"  [{name}] {len(hits)} keys use ！/？ with no `!`/`?` anywhere in English")

# ---------------------------------------------------------------------------
head("2. `·` — carried from the English source, or introduced?")

for name, zh, en in BUNDLES:
    zh_keys = [k for k, v in zh.items() if "·" in v]
    introduced = [k for k in zh_keys if "·" not in en.get(k, "")]
    missing = [k for k, v in en.items() if "·" in v and "·" not in zh.get(k, "")]
    print(f"\n--- {name} ---")
    print(f"  zh has `·` on {len(zh_keys)} keys; English has `·` on {len(zh_keys) - len(introduced)}")
    print(f"  zh introduces `·` where English has none: {len(introduced)}")
    for k in introduced:
        print(f"      {k}\n        zh: {zh[k]!r}\n        en: {en.get(k)!r}")
    print(f"  English has `·` but zh does not: {len(missing)}")
    for k in missing[:15]:
        print(f"      {k}\n        zh: {zh.get(k)!r}\n        en: {en[k]!r}")
    if len(missing) > 15:
        print(f"      ... {len(missing) - 15} more")
    # shape: is it always ` · ` (spaced both sides)?
    shapes = Counter()
    for k in zh_keys:
        for m in re.finditer("·", zh[k]):
            v = zh[k]
            before = v[m.start() - 1] if m.start() else ""
            after = v[m.end()] if m.end() < len(v) else ""
            shapes[(before == " ", after == " ")] += 1
    print(f"  spacing shapes (spaced_before, spaced_after) -> occurrences: {dict(shapes)}")

# ---------------------------------------------------------------------------
head("3. `—` — the cross-tab: does zh follow the English form or convert it?")

for name, zh, en in BUNDLES:
    print(f"\n--- {name} ---")
    zh_dash = {k: v for k, v in zh.items() if "—" in v or "–" in v}
    tab = Counter()
    detail = defaultdict(list)
    for k, v in zh_dash.items():
        e = en.get(k, "")
        zh_spaced_single = bool(re.search(r"(?<!—)—(?!—)", v)) and " — " in v
        zh_doubled = "——" in v
        en_spaced_single = " — " in e
        zh_form = (
            "—— doubled" if zh_doubled and not zh_spaced_single
            else " — spaced single" if zh_spaced_single and not zh_doubled
            else "both" if zh_doubled and zh_spaced_single
            else "unspaced single"
        )
        en_form = " — spaced single" if en_spaced_single else ("— other" if "—" in e else "no dash")
        tab[(zh_form, en_form)] += 1
        detail[(zh_form, en_form)].append(k)
    for (zh_form, en_form), n in sorted(tab.items(), key=lambda x: -x[1]):
        print(f"  zh {zh_form:<20} <- en {en_form:<18} : {n} keys")
        for k in detail[(zh_form, en_form)][:6]:
            print(f"        {k}: {zh[k]!r}")
        if n > 6:
            print(f"        ... {n - 6} more")

head("3b. the ` — ` survivors, in full")
for name, zh, en in BUNDLES:
    print(f"\n--- {name} ---")
    for k, v in sorted(zh.items()):
        if " — " in v:
            print(f"    {k}")
            print(f"      zh: {v!r}")
            print(f"      en: {en.get(k)!r}")

head("3c. the `——` majority: a sample of the same kind of string")
for name, zh, en in BUNDLES:
    print(f"\n--- {name} ---")
    n = 0
    for k, v in sorted(zh.items()):
        if "——" in v and ("暂无" in v or "没有" in v or "为空" in v):
            print(f"    {k}: {v!r}")
            n += 1
    print(f"    ({n} empty-state keys use ——)")

head("3d. `–` en dash survivors")
for name, zh, en in BUNDLES:
    for k, v in sorted(zh.items()):
        if "–" in v:
            print(f"  [{name}] {k}: {v!r}\n      en: {en.get(k)!r}")
