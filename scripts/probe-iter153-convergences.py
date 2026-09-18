#!/usr/bin/env python3
"""Re-measure the 146/151-round convergences that left no re-derivable before-count.

The 148 round converged `instance`/`desktop`/`provider` and recorded what it
measured first, so `ja-ko-unlisted-terms.test.ts` can assert
`current(primary) == before(primary) + Σ before(rivals)`. The 146 round
(concepts) and the 151 round (`フォルダ`, the zh brackets) converged the same way
but left their before-counts in prose, where nothing re-derives them.

Every number is read off git rather than copied from a commit message: the 150
round's own message says "5 half-width pairs against 74 full-width ones" while
the bundle at that revision held 70 full-width and 4 half-width in views, plus
36 and 1 in mobile — the message mixed a post-convergence count with a
pre-convergence one.

A case is `(round, revision-before, label, locale, scope, en, primary, rival)`.
`scope` is `concept` when the key set is the one whose *English* source names the
term (what `Measure.keysFrom` derives) and `bundle` when it is the whole locale.
Latin patterns are matched case-insensitively: the 146 round's stragglers are
`Daemon`/`Runtime`/`Agent` as often as the lowercase form, and a case-sensitive
probe reads 2 where the bundle holds 5.

Usage: python3 scripts/probe-iter153-convergences.py
"""

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The literals the concepts guard masks before any pattern runs.
MASKED = [
    re.compile(r"\{\{[^}]*\}\}"),
    re.compile(r"`[^`]*`"),
    re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b"),
]

LATIN = r"(?<![A-Za-z])%s(?![A-Za-z])"

CASES = [
    ("146", "349762a55^", "daemon", "ja", "concept", LATIN % "daemons?", "デーモン", LATIN % "daemons?"),
    ("146", "349762a55^", "daemon", "ko", "concept", LATIN % "daemons?", "데몬", LATIN % "daemons?"),
    ("146", "349762a55^", "runtime", "ja", "concept", LATIN % "runtimes?", "ランタイム", LATIN % "runtimes?"),
    ("146", "349762a55^", "runtime", "ko", "concept", LATIN % "runtimes?", "런타임", LATIN % "runtimes?"),
    ("146", "349762a55^", "agent", "ja", "concept", LATIN % "agents?", "エージェント", LATIN % "agents?"),
    ("146", "349762a55^", "agent", "ko", "concept", LATIN % "agents?", "에이전트", LATIN % "agents?"),
    ("146", "349762a55^", "inbox", "ja", "concept", LATIN % "inbox", "インボックス", "受信トレイ"),
    ("146", "349762a55^", "inbox", "ko", "concept", LATIN % "inbox", "인박스", "수신함"),
    ("146", "349762a55^", "member", "ko", "concept", LATIN % "members?", "멤버", "구성원"),
    ("146", "349762a55^", "autopilot", "ja", "concept", LATIN % "autopilots?", "オートパイロット", "自動化"),
    ("146", "349762a55^", "reply", "ja", "concept", LATIN % "repl(y|ies)", "返信", "回答|応答"),
    ("151", "d62b9f54f^", "フォルダ", "ja", "bundle", None, "フォルダ(?!ー)", "フォルダー"),
]


def mask(value: str) -> str:
    for pattern in MASKED:
        value = pattern.sub("…", value)
    return value


def flatten(value, prefix=""):
    if not isinstance(value, dict):
        return {prefix: str(value)}
    out = {}
    for key, child in value.items():
        out.update(flatten(child, f"{prefix}.{key}" if prefix else key))
    return out


def load(rev: str, locale: str) -> dict:
    out = {}
    for path in sorted((ROOT / f"packages/views/locales/{locale}").glob("*.json")):
        raw = subprocess.run(
            ["git", "show", f"{rev}:packages/views/locales/{locale}/{path.name}"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        for key, value in flatten(json.loads(raw)).items():
            out[f"{path.stem}.{key}"] = value
    return out


def keys_for(rev: str, locale: str, scope: str, en_pattern) -> list[str]:
    target = load(rev, locale)
    if scope == "bundle":
        return list(target)
    rx = re.compile(en_pattern, re.I)
    en = load(rev, "en")
    return [key for key, value in en.items() if rx.search(mask(value)) and not key.endswith("_one")]


def tally(rev: str, locale: str, scope: str, en_pattern, primary: str, rival: str):
    target = load(rev, locale)
    keys = keys_for(rev, locale, scope, en_pattern)
    rx_primary, rx_rival = re.compile(primary), re.compile(rival, re.I)
    native = [key for key in keys if rx_primary.search(mask(target.get(key, "")))]
    rivals = [key for key in keys if rx_rival.search(mask(target.get(key, "")))]
    return keys, native, rivals


def main() -> None:
    for round_, rev, label, locale, scope, en_pattern, primary, rival in CASES:
        keys, native, rivals = tally(rev, locale, scope, en_pattern, primary, rival)
        _, native_now, rivals_now = tally("HEAD", locale, scope, en_pattern, primary, rival)
        clean = len(native_now) == len(native) + len(rivals) and not rivals_now
        print(
            f"{'OK ' if clean else 'NO '}[{round_}] {label} ({locale}, {scope}, {len(keys)} keys): "
            f"before {len(native)} native + {len(rivals)} rival -> now {len(native_now)} native "
            f"+ {len(rivals_now)} rival"
        )
        for key in rivals:
            print(f"      was rival: {key}")
        for key in rivals_now:
            print(f"      still rival: {key}")


if __name__ == "__main__":
    main()
