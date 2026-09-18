#!/usr/bin/env python3
"""Classify the ko Latin/Hangul junctions: a particle attaches, a noun is spaced.

The first pass counted 163 tight junctions against 247 spaced ones and read like
a split. It is not one. Every tight junction in the sample is a Latin word with a
Korean *particle* on it (`CLI가`, `App을`, `Builder를`), and every spaced junction
is a Latin word followed by a Korean *noun* (`AI 팀원`, `API 토큰`). Those are two
different questions, and the first pass was answering both at once.

Korean orthography separates words and attaches particles, so if the bundle
follows it there is no split at all: the rule is "particle tight, noun spaced",
and the only thing worth measuring is whether any junction breaks it.

Usage: python3 scripts/probe-iter153-ko-notation.py --particles
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KO = ROOT / "packages/views/locales/ko"

HANGUL = "가-힣"
MASKED = [re.compile(r"\{\{[^}]*\}\}"), re.compile(r"`[^`]*`")]
TOKEN = re.compile(rf"[A-Za-z][A-Za-z0-9.+#/_-]*|[{HANGUL}]+|[0-9]+|\s+|.")
LATIN = re.compile(r"[A-Za-z][A-Za-z0-9.+#/_-]*")
HANGUL_RUN = re.compile(rf"[{HANGUL}]+")

# The particles, copulas and verb endings a Latin token can take. Matched
# against the **whole** Hangul run, not a prefix of it: the first version tested
# `run.startswith(particle)` and read `AI 에이전트를` as the particle `에` on a
# noun `이전트를`, which is the `표`/`표시` false positive again in a different
# guise. A run that is longer than any particle is a word, and a word is spaced.
PARTICLES = [
    "에서는", "으로는", "에게는", "에서도", "으로도", "에게도", "이라고", "이라는",
    "으로써", "으로서", "에게서", "부터는", "까지는", "뿐입니다", "뿐이며", "입니다",
    "에서", "으로", "에게", "부터", "까지", "처럼", "보다", "마다", "이나", "이며",
    "이고", "이라", "라는", "이란", "이든", "와는", "과는", "에는", "에도", "에만",
    "하면", "이", "가", "을", "를", "은", "는", "에", "의", "와", "과", "도", "만",
    "로", "나", "고", "라", "야", "여", "며", "뿐",
]


def flatten(value, prefix=""):
    if not isinstance(value, dict):
        return {prefix: str(value)}
    out = {}
    for key, child in value.items():
        out.update(flatten(child, f"{prefix}.{key}" if prefix else key))
    return out


def load() -> dict:
    out = {}
    for path in sorted(KO.glob("*.json")):
        for key, value in flatten(json.loads(path.read_text())).items():
            out[f"{path.stem}.{key}"] = value
    return out


def masked(value: str) -> str:
    for pattern in MASKED:
        value = pattern.sub("…", value)
    return value


def is_particle(run: str) -> bool:
    return run in PARTICLES


def junctions(value: str):
    """(latin, separator, hangul, rest-of-hangul-run) for every Latin/Hangul junction."""
    tokens = TOKEN.findall(value)
    for index, token in enumerate(tokens):
        if not LATIN.fullmatch(token):
            continue
        if index + 1 < len(tokens) and HANGUL_RUN.fullmatch(tokens[index + 1]):
            yield token, "", tokens[index + 1]
        elif (
            index + 2 < len(tokens)
            and re.fullmatch(r"\s+", tokens[index + 1])
            and HANGUL_RUN.fullmatch(tokens[index + 2])
        ):
            yield token, tokens[index + 1], tokens[index + 2]


def main() -> None:
    ko = load()
    counts = {"particle tight": [], "particle spaced": [], "noun tight": [], "noun spaced": []}
    for key, value in ko.items():
        for left, separator, right in junctions(masked(value)):
            kind = "particle" if is_particle(right) else "noun"
            where = "tight" if separator == "" else "spaced"
            counts[f"{kind} {where}"].append((key, left, right))

    for name, found in counts.items():
        keys = {key for key, _, _ in found}
        print(f"{name:16s} {len(found):5d} junctions over {len(keys):4d} keys")
        if name.startswith("noun tight") or name.startswith("particle spaced"):
            for key, left, right in found[:20]:
                print(f"      {key}: {left}|{right}")


if __name__ == "__main__":
    main()
