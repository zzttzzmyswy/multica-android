#!/usr/bin/env python3
"""Round 152, item 3 — ja sokuon (ッ) and yoon (ャュョ) notation.

Round 151 settled the *long vowel* axis (`ー`) and the *vowel* axis
(`デフォルト` / `ディフォルト`): 13 words, zero exceptions, pinned. It did not touch
the two neighbouring axes this round has to measure:

  - **sokuon `ッ`** — `セッション` vs `セション`, `コミット` vs `コミト`. A word
    written both ways is the same defect shape the 151 round found on `フォルダ`
    (8:1 with the straggler in a different surface).
  - **yoon `ャュョ`** — `キャンセル` vs `キヤンセル`. The large-kana spelling is
    not a variant, it is simply wrong: after an i-column kana (キ シ チ ニ ヒ ミ
    リ ギ ジ ビ ピ) the glide kana is always small in modern Japanese. So this
    axis has an *absolute* rule, not a majority one, and the claim is "zero
    occurrences" rather than "N vs 1".

Rather than guess a word list (the way a majority tally invites), both axes are
found by **normalisation**: every katakana token in the bundle is folded once
(remove `ッ`, or enlarge small kana) and the tokens are grouped by their folded
form. A group with more than one distinct member is a word spelled two ways —
which is exactly the thing being looked for, and it is found without knowing in
advance which words are in the bundle.

The ko side is checked for the mirror question 151 left open: any loosening
outside loanword notation. 151 already measured the particles after `〜됨`
(empty) and the `리뷰`/`레이블` splits (open, in the ledger), so this script only
looks for *new* classes.
"""

import json
import os
import re
from collections import Counter, defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEWS = os.path.join(REPO, "packages/views/locales")
MOBILE = os.path.join(REPO, "apps/mobile/lib/i18n/locales")

KATAKANA = re.compile("[ァ-ヺー]")
KATA_RUN = re.compile("[ァ-ヺー]{2,}")

SMALL = "ァィゥェォッャュョヮ"
LARGE_OF = {"ァ": "ア", "ィ": "イ", "ゥ": "ウ", "ェ": "エ", "ォ": "オ",
            "ッ": "ツ", "ャ": "ヤ", "ュ": "ユ", "ョ": "ヨ", "ヮ": "ワ"}

# i-column kana: a *glide* kana (ャュョ) directly after one of these must be
# small. Only the glide kana: シアター and ジオメトリ are ordinary i+vowel
# sequences, not mis-sized glides, so a vowel kana after an i-column kana is not
# evidence of anything.
I_COLUMN = "キシチニヒミリギジビピ"

# ko jamo blocks, for the "loosening outside loanwords" check.
HANGUL = re.compile("[가-힣]")


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


# ja and ko exist only in the views bundle: the mobile app ships zh and en only
# (round 144 established this), so there is no mobile ja/ko half to measure.
JA = [("views ja", load_views("ja"))]
KO = [("views ko", load_views("ko"))]


def head(title):
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


def tokens(bundle):
    """Every katakana run, with the keys it came from."""
    found = defaultdict(set)
    for key, value in bundle.items():
        for run in KATA_RUN.findall(value):
            found[run].add(key)
    return found


# ---------------------------------------------------------------------------
head("1. sokuon — katakana tokens grouped by their ッ-folded form")

for name, bundle in JA:
    found = tokens(bundle)
    groups = defaultdict(list)
    for run in found:
        groups[run.replace("ッ", "")].append(run)
    splits = {fold: members for fold, members in groups.items() if len(members) > 1}
    print(f"\n--- {name} --- {len(found)} distinct katakana tokens")
    print(f"  groups that fold to the same form but differ: {len(splits)}")
    for fold, members in sorted(splits.items()):
        counts = {m: len(found[m]) for m in sorted(members)}
        print(f"    {fold}: {counts}")
        for m in sorted(members):
            for k in sorted(found[m])[:4]:
                print(f"        [{m}] {k}: {bundle[k]!r}")
            if len(found[m]) > 4:
                print(f"        [{m}] ... {len(found[m]) - 4} more keys")

head("1b. the reverse — a ッ where the fold says it should not be there")
for name, bundle in JA:
    found = tokens(bundle)
    # a token whose ッ-folded form is itself also present is caught above; this
    # asks the complementary question: is any ッ inside a word that has no
    # sokuon in standard Japanese? Report every ッ-bearing token with its count
    # so the reader can eyeball the list rather than trust a rule.
    with_sokuon = {t: len(k) for t, k in found.items() if "ッ" in t}
    print(f"\n--- {name} --- {len(with_sokuon)} distinct tokens carry ッ")
    for t, n in sorted(with_sokuon.items()):
        print(f"    {t}  ({n} keys)")

# ---------------------------------------------------------------------------
head("2. yoon — a large ヤユヨ after an i-column kana is always wrong")

BAD_YOON = re.compile(f"[{I_COLUMN}][ヤユヨ]")

for name, bundle in JA:
    hits = []
    for key, value in bundle.items():
        for m in BAD_YOON.finditer(value):
            hits.append((key, value, m.group(0)))
    print(f"\n--- {name} --- {len(hits)} occurrences of a large glide kana after an i-column kana")
    for key, value, frag in hits:
        print(f"    {key}: {value!r}  (fragment {frag!r})")

head("2b. the yoon fold — tokens grouped by small->large normalisation")
for name, bundle in JA:
    found = tokens(bundle)
    groups = defaultdict(list)
    for run in found:
        folded = "".join(LARGE_OF.get(ch, ch) for ch in run)
        groups[folded].append(run)
    splits = {f: m for f, m in groups.items() if len(m) > 1}
    print(f"\n--- {name} --- groups that differ only by small/large kana: {len(splits)}")
    for fold, members in sorted(splits.items()):
        print(f"    {fold}: {{m: len(found[m]) for m in members}}")
        for m in sorted(members):
            for k in sorted(found[m])[:3]:
                print(f"        [{m}] {k}: {bundle[k]!r}")

head("2c. small kana actually in use, by frequency (the positive evidence)")
for name, bundle in JA:
    counter = Counter()
    for run in tokens(bundle):
        for ch in run:
            if ch in SMALL:
                counter[ch] += 1
    print(f"  [{name}] {dict(counter.most_common())}")

# ---------------------------------------------------------------------------
# The 151 long-vowel pins are re-measured by `probe-iter151-staleness.py`, which
# already re-derives every number the ledger's `why` states. This script does not
# duplicate it — see round 152, item 5.

head("4. ko — any loosening outside loanword notation?")
# 151 measured the particles after 〜됨 (empty) and left 리뷰/레이블 in the ledger.
# This looks for a *new* class: a Hangul word written with an inter-letter space,
# which Korean orthography forbids inside a word.
for name, bundle in KO:
    hits = []
    for key, value in bundle.items():
        for m in re.finditer("[가-힣] [가-힣]", value):
            hits.append((key, value, m.group(0)))
    print(f"\n--- {name} --- {len(hits)} occurrences of a space inside a Hangul word")
    for key, value, frag in hits[:25]:
        print(f"    {key}: {value!r}  (fragment {frag!r})")
    if len(hits) > 25:
        print(f"    ... {len(hits) - 25} more")
