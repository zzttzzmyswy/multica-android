#!/usr/bin/env python3
"""Measure the key sets the 151 round's three whole-bundle convergences cover.

The 154 round pinned `scopeSize` on every `converged` claim whose scope is a
*derived* key set (`keysFrom`), and recorded why it did not pin the three that
remain: `フォルダ` (ja) and the two zh bracket claims measure the whole locale,
and a whole bundle grows for reasons that have nothing to do with the claim, so
pinning its size would turn every unrelated string into a failure.

The consequence is that those three still report a grown scope as
"either the convergence was partial or the tally was wrong". This probe asks
whether the scope can be narrowed to a set that *is* about the claim — the keys
whose value carries the term at all, primary or rival — and what that set's size
is. The narrowed set counts the same occurrences as the whole bundle (a key that
carries neither form contributes zero to either pattern), so narrowing costs the
claim nothing and gives it a number that can be pinned.

Each case reports, for the current bundle:
  keys      — size of the narrowed set (the candidate `scopeSize`)
  primary   — occurrences of the majority form over it
  rival     — occurrences of the straggler form over it
  sum       — what a total convergence leaves behind, i.e. the pinned `expected`

Usage: python3 scripts/probe-iter155-scope-narrowing.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages/views/locales"

# The code-span stripper `zh-typography.test.ts` masks with.
CODE_SPAN = re.compile(r"`[^`]*`")


def views(locale: str) -> dict[str, str]:
    bundle: dict[str, str] = {}
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


def mobile(locale: str) -> dict[str, str]:
    raw = json.loads(
        (ROOT / f"apps/mobile/lib/i18n/locales/{locale}.json").read_text(encoding="utf-8")
    )
    return {key: str(value) for key, value in raw.items()}


# (label, bundle, mask, union, primary, rival)
CASES = [
    (
        "フォルダ (ja)",
        views("ja"),
        lambda value: value,
        re.compile(r"フォルダ"),
        re.compile(r"フォルダ(?!ー)"),
        re.compile(r"フォルダー"),
    ),
    (
        "brackets (views zh-Hans)",
        views("zh-Hans"),
        lambda value: CODE_SPAN.sub(" ", value),
        re.compile(r"（[^（）]*）|\([^()]*\)"),
        re.compile(r"（[^（）]*）"),
        re.compile(r"\([^()]*\)"),
    ),
    (
        "brackets (mobile zh)",
        mobile("zh"),
        lambda value: CODE_SPAN.sub(" ", value),
        re.compile(r"（[^（）]*）|\([^()]*\)"),
        re.compile(r"（[^（）]*）"),
        re.compile(r"\([^()]*\)"),
    ),
]

print(f"{'claim':28} {'keys':>5} {'primary':>8} {'rival':>6} {'sum':>5}  whole-bundle primary/rival")
for label, bundle, mask, union, primary, rival in CASES:
    masked = {key: mask(value) for key, value in bundle.items()}
    narrowed = {key: value for key, value in masked.items() if union.search(value)}
    over_narrowed = sum(len(primary.findall(v)) for v in narrowed.values())
    rival_narrowed = sum(len(rival.findall(v)) for v in narrowed.values())
    over_all = sum(len(primary.findall(v)) for v in masked.values())
    rival_all = sum(len(rival.findall(v)) for v in masked.values())
    print(
        f"{label:28} {len(narrowed):5} {over_narrowed:8} {rival_narrowed:6} "
        f"{over_narrowed + rival_narrowed:5}  {over_all}/{rival_all}"
    )
    if (over_narrowed, rival_narrowed) != (over_all, rival_all):
        print("  !! narrowing changed a count — the union pattern is not a superset")
