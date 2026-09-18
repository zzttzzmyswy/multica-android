#!/usr/bin/env python3
"""Iteration 150, item 4 — coverage review of the ledger and the guards.

Four checks the 149 round left open:

  1. The `Server` ledger entry is `locale: "ja"` only, but the conventions.mdx row
     claims a ko fact too ("23 Latin vs 15 サーバー / 서버"). Is the ko side
     actually split, and is anything verifying it?
  2. Every `why` mixes two count calibers — by key and by occurrence. Which
     caliber does each recorded number use?
  3. 149 declined to extend the ko figure+counter rule to placeholders because ko
     counters double as word-initials. Is there a zero-false-positive detector?
  4. LATIN_KEPT (Gateway / Severity / payload) — are the two exclusions (Fleet,
     Local) still right, and is anything missing?

Read-only.
"""

import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages" / "views" / "locales"

MASKED = [
    re.compile(r"`[^`]*`"),
    re.compile(r"\{\{[^}]*\}\}"),
    re.compile(r"SKILL\.md"),
    re.compile(r"Skills\.sh"),
    re.compile(r"skill-name"),
    re.compile(r"@squad"),
    re.compile(r"Agent Builder"),
    re.compile(r"agent/…"),
    re.compile(r"my-workspace"),
]


def mask(value: str) -> str:
    for pattern in MASKED:
        value = pattern.sub("…", value)
    return value


def load(locale: str) -> dict:
    bundle = {}
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


EN = load("en")
JA = load("ja")
KO = load("ko")


def header(title):
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


# --------------------------------------------------------------- 1. Server / ko
header("1. the Server entry — the doc claims a ko fact, the ledger only pins ja")

SERVER_LATIN = re.compile(r"(?<![A-Za-z])Servers?(?![A-Za-z])")
SERVER_KO = re.compile(r"서버")
SERVER_JA = re.compile(r"サーバー")

for name, bundle, latin, native in [
    ("ja", JA, SERVER_LATIN, SERVER_JA),
    ("ko", KO, SERVER_LATIN, SERVER_KO),
]:
    print(f"\n  --- {name}, whole bundle")
    print(f"      by key       : Latin {sum(1 for v in bundle.values() if latin.search(v)):3d}  "
          f"native {sum(1 for v in bundle.values() if native.search(v)):3d}")
    print(f"      by occurrence: Latin {sum(len(latin.findall(v)) for v in bundle.values()):3d}  "
          f"native {sum(len(native.findall(v)) for v in bundle.values()):3d}")

for name, bundle, native in [("ja", JA, SERVER_JA), ("ko", KO, SERVER_KO)]:
    print(f"\n  --- {name}, agents.tab_body.mcp_config.* only")
    keys = [k for k in bundle if k.startswith("agents.tab_body.mcp_config.")]
    lat = [k for k in keys if SERVER_LATIN.search(bundle[k])]
    nat = [k for k in keys if native.search(bundle[k])]
    print(f"      keys {len(keys)} | Latin {len(lat)} | native {len(nat)}")
    print(f"\n  --- {name}, settings.mcp.* only")
    keys = [k for k in bundle if k.startswith("settings.mcp.")]
    lat = [k for k in keys if SERVER_LATIN.search(bundle[k])]
    nat = [k for k in keys if native.search(bundle[k])]
    print(f"      keys {len(keys)} | Latin {len(lat)} | native {len(nat)}")
    for key in sorted(keys):
        print(f"        {key}: {bundle[key]!r}")


# ------------------------------------------------------- 2. caliber of each why
header("2. caliber check — the numbers the ledger records, re-measured both ways")

CHECKS = [
    ("Server ja — agents.tab_body.mcp_config.*", "ja", SERVER_LATIN, SERVER_JA,
     "agents.tab_body.mcp_config."),
    ("review ko — 검토 vs 리뷰", "ko", re.compile(r"리뷰"), re.compile(r"검토"), None),
    ("label ko — 라벨 vs 레이블", "ko", re.compile(r"레이블"), re.compile(r"라벨"), None),
    ("register ko — 습니다 vs 해요체", "ko", re.compile(r"습니다"),
     re.compile(r"(어요|아요|세요|예요|이에요|해요)"), None),
    ("Private ja — プライベート vs 非公開", "ja", re.compile(r"プライベート"),
     re.compile(r"非公開"), None),
]

BUNDLES = {"ja": JA, "ko": KO}
for label, locale, a, b, prefix in CHECKS:
    bundle = BUNDLES[locale]
    keys = [k for k in bundle if prefix is None or k.startswith(prefix)]
    for name, pattern in [("A", a), ("B", b)]:
        by_key = sum(1 for k in keys if pattern.search(bundle[k]))
        by_occ = sum(len(pattern.findall(bundle[k])) for k in keys)
        print(f"  {label:44s} {name}: by key {by_key:4d} | by occurrence {by_occ:4d}")


# ------------------------------------------- 3. ko counter rule on placeholders
header("3. ko figure+counter rule extended to placeholders — FP check")

# 149's objection: a ko counter doubles as a word-initial, so `{{index}} 편집`
# and `{{when}} 시작됨` look like `}} <counter>`. Narrow the detector to count-like
# placeholder names, which is the only place a figure+counter pair can occur.
COUNT_LIKE = (
    r"count|total|shown|passed|failed|running|queued|deleted|days|hours|minutes|"
    r"seconds|value|limit|remaining|used|size|index"
)
PLACEHOLDER_TIGHT = re.compile(r"\{\{(?:" + COUNT_LIKE + r")\}\}\s*([가-힣]{1,3})")
PLACEHOLDER_SPACED = re.compile(r"\{\{(?:" + COUNT_LIKE + r")\}\}\s+([가-힣]{1,3})")
KO_COUNTERS = {
    "개", "명", "건", "가지", "번", "회", "일", "초", "분", "시간", "주", "달",
    "개월", "년", "자리", "종", "편", "줄", "페이지", "회차", "곳", "대", "번째",
}

for name, pattern in [("tight", PLACEHOLDER_TIGHT), ("spaced", PLACEHOLDER_SPACED)]:
    hits = []
    for key in sorted(KO):
        for counter in pattern.findall(mask(KO[key])):
            if counter in KO_COUNTERS:
                hits.append((key, counter, KO[key]))
    print(f"\n  {name}: {len(hits)} hits")
    for key, counter, value in hits[:12]:
        print(f"      {counter:4s} {key}: {value!r}")

# What the narrow detector misses: a count-like placeholder followed by something
# that is NOT a counter. Those are the would-be false positives.
print("\n  --- count-like placeholder followed by a non-counter (would-be FPs)")
for key in sorted(KO):
    for counter in PLACEHOLDER_TIGHT.findall(mask(KO[key])):
        if counter not in KO_COUNTERS:
            print(f"      {counter!r} {key}: {KO[key]!r}")


# ------------------------------------------------------------- 4. LATIN_KEPT
header("4. LATIN_KEPT — re-check the exclusions and look for new candidates")

# A LATIN_KEPT candidate: both locales keep the Latin word, and the plausible
# native rendering appears zero times in both bundles.
CANDIDATES = {
    "Gateway": (r"(?<![A-Za-z])Gateway(?![A-Za-z])", {"ja": r"ゲートウェイ", "ko": r"게이트웨이"}),
    "Severity": (r"(?<![A-Za-z])Severity(?![A-Za-z])", {"ja": r"重大度|深刻度", "ko": r"심각도"}),
    "payload": (r"(?<![A-Za-z])payload(?![A-Za-z])", {"ja": r"ペイロード", "ko": r"페이로드"}),
    "Fleet": (r"(?<![A-Za-z])Fleet(?![A-Za-z])", {"ja": r"フリート", "ko": r"플릿"}),
    "Local": (r"(?<![A-Za-z])Local(?![A-Za-z])", {"ja": r"ローカル", "ko": r"로컬"}),
    "Workspace": (r"(?<![A-Za-z])Workspace(?![A-Za-z])", {"ja": r"ワークスペース", "ko": r"워크스페이스"}),
    "Sandbox": (r"(?<![A-Za-z])Sandbox(?![A-Za-z])", {"ja": r"サンドボックス", "ko": r"샌드박스"}),
    "Session": (r"(?<![A-Za-z])Session(?![A-Za-z])", {"ja": r"セッション", "ko": r"세션"}),
    "Patch": (r"(?<![A-Za-z])Patch(?![A-Za-z])", {"ja": r"パッチ", "ko": r"패치"}),
    "Token": (r"(?<![A-Za-z])Tokens?(?![A-Za-z])", {"ja": r"トークン", "ko": r"토큰"}),
    "Secret": (r"(?<![A-Za-z])Secrets?(?![A-Za-z])", {"ja": r"シークレット", "ko": r"시크릿"}),
    "Host": (r"(?<![A-Za-z])Host(?![A-Za-z])", {"ja": r"ホスト", "ko": r"호스트"}),
    "Webhook": (r"(?<![A-Za-z])Webhook(?![A-Za-z])", {"ja": r"ウェブフック|webhook", "ko": r"웹훅"}),
}

for term, (latin, natives) in CANDIDATES.items():
    latin_re = re.compile(latin)
    rows = []
    for locale, bundle in [("ja", JA), ("ko", KO)]:
        native_re = re.compile(natives[locale], re.I)
        lat_keys = [k for k in bundle if latin_re.search(bundle[k])]
        nat_keys = [k for k in bundle if native_re.search(bundle[k])]
        rows.append((locale, len(lat_keys), len(nat_keys)))
    verdict = "BOTH-LATIN" if all(nat == 0 for _, _, nat in rows) else "native present"
    print(f"  {term:11s} " + "  ".join(f"{loc}: latin {lat:3d} native {nat:3d}" for loc, lat, nat in rows)
          + f"   -> {verdict}")

print()
print("done.")
