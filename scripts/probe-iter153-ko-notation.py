#!/usr/bin/env python3
"""The ko surfaces the 152 round recorded as untested.

152 pinned ja's sokuon and yoon and closed ko out with a negative result: the
three katakana folds have no Korean counterpart. That leaves three ko surfaces
nobody has measured, and this script measures them without deciding anything —
the round's rule is that a zero-exception result may be pinned and a split goes
to the ledger.

  1. **Latin next to Hangul.** 149/150 settled figures and counters (tight, 170
     keys / 179 occurrences / 0 spaced). A Latin *word* beside a Hangul word is a
     different question.
  2. **Sino-Korean against native Korean for one English word** — the shape zh
     has in 任务/问题. The pairs already in the ledger (`라벨`/`레이블`,
     `리뷰`/`검토`) are excluded by construction.
  3. **Status suffixes other than `〜됨`.** 150 pinned the pure status label as
     `〜됨` (62 keys, `〜된` 0) and 151 measured the particles after it as the
     empty set. `〜중` and the rest were never looked at.

Two measurement traps this script exists to avoid, both of them 151's:

  - **An interpolated alternation leaks to the top level.** The first version
    built `rf"{LATIN}|{LATIN2}[{HANGUL}]"` and every one of the four adjacency
    counts came out at 1092 — the same number, which is what gave it away.
    Patterns are grouped here, and the boundary walk does not use an alternation
    at all.
  - **A native form can be a substring of an unrelated word.** `표` ("table")
    matches `표시` ("display") 105 times, which is the `템플릿`/`플릿` false
    positive one file over. Every candidate is anchored so it cannot sit inside
    a longer Hangul word, and `체크리스트` ("checklist") is excluded from
    `리스트`.

Usage: python3 scripts/probe-iter153-ko-notation.py
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KO = ROOT / "packages/views/locales/ko"

HANGUL = "가-힣"
# A placeholder or an inline code span is filled in or copied at render time, and
# 150 already pinned how a figure sits against a counter. Masking both leaves the
# question this probe is about: a Latin *word* beside a Hangul word.
MASKED = [re.compile(r"\{\{[^}]*\}\}"), re.compile(r"`[^`]*`")]
TOKEN = re.compile(rf"[A-Za-z][A-Za-z0-9.+#/_-]*|[{HANGUL}]+|[0-9]+|\s+|.")

SINO_NATIVE = [
    ("list", r"목록", r"(?<!체크)리스트"),
    ("table", r"테이블", rf"(?<![{HANGUL}])표(?![{HANGUL}])"),
    ("user", r"사용자", rf"(?<![{HANGUL}])유저(?![{HANGUL}])"),
    ("error", r"오류", r"에러"),
    ("screen", r"화면", r"스크린"),
    ("message", r"메시지", r"쪽지"),
    ("image", r"이미지", r"그림"),
    ("name", r"이름", r"명칭"),
    ("start", r"시작", r"개시"),
    ("end", r"종료", rf"(?<![{HANGUL}])끝(?![{HANGUL}])"),
    ("change", r"변경", r"바꾸기"),
    ("check", r"확인", r"검사"),
    ("use", r"사용", r"이용"),
    ("delete", r"삭제", r"지우기"),
    ("add", r"추가", r"더하기"),
    ("select", r"선택", r"고르기"),
    ("save", r"저장", r"보관"),
    ("search", r"검색", r"찾기"),
]

STATUS_SUFFIXES = ["됨", "된", "중", "완료", "없음", "가능", "불가", "대기", "실패", "예정"]


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


def boundaries(value: str) -> list[tuple[str, str, str]]:
    """Every Latin/Hangul junction, as (left, separator, right)."""
    tokens = TOKEN.findall(value)
    found = []
    for index, token in enumerate(tokens[:-1]):
        nxt = tokens[index + 1]
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9.+#/_-]*", token):
            continue
        if not re.fullmatch(rf"[{HANGUL}]+", nxt):
            continue
        found.append((token, "", nxt))
    for index, token in enumerate(tokens[:-2]):
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9.+#/_-]*", token):
            continue
        if not re.fullmatch(r"\s+", tokens[index + 1]):
            continue
        if not re.fullmatch(rf"[{HANGUL}]+", tokens[index + 2]):
            continue
        found.append((token, tokens[index + 1], tokens[index + 2]))
    return found


def keys_matching(bundle: dict, pattern: str) -> list[str]:
    rx = re.compile(pattern)
    return [key for key, value in bundle.items() if rx.search(value)]


def main() -> None:
    ko = load()
    print(f"ko bundle: {len(ko)} keys\n")

    print("1. Latin and Hangul at a word boundary")
    tight: dict[str, list[str]] = {}
    spaced: dict[str, list[str]] = {}
    for key, value in ko.items():
        for left, separator, right in boundaries(masked(value)):
            (tight if separator == "" else spaced).setdefault(f"{left}|{right}", []).append(key)
    print(f"   tight  {len(tight):4d} distinct junctions over {len({k for v in tight.values() for k in v})} keys")
    for junction, keys in sorted(tight.items())[:15]:
        print(f"        {junction:24s} x{len(keys):3d}  e.g. {keys[0]}")
    print(f"   spaced {len(spaced):4d} distinct junctions over {len({k for v in spaced.values() for k in v})} keys")
    for junction, keys in sorted(spaced.items())[:15]:
        print(f"        {junction:24s} x{len(keys):3d}  e.g. {keys[0]}")
    both = sorted(set(tight) & set(spaced))
    print(f"   junctions that appear both ways: {len(both)} {both[:8]}")
    print()

    print("2. Sino-Korean against native Korean")
    for label, sino, native in SINO_NATIVE:
        a, b = keys_matching(ko, sino), keys_matching(ko, native)
        if not a and not b:
            continue
        print(f" {'!!' if a and b else '  '} {label:9s} {sino:22s} {len(a):4d}   vs  {native:24s} {len(b):4d}")
        for key in b[:8]:
            print(f"        native: {key}: {json.dumps(ko[key], ensure_ascii=False)[:100]}")
    print()

    print("3. Status-form suffixes")
    for suffix in STATUS_SUFFIXES:
        keys = keys_matching(ko, rf"{suffix}(?![{HANGUL}])")
        print(f"   〜{suffix:5s} {len(keys):4d} keys")
        for key in keys[:3]:
            print(f"        {key}: {json.dumps(ko[key], ensure_ascii=False)[:100]}")


if __name__ == "__main__":
    main()
