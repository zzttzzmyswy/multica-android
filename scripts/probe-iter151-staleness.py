#!/usr/bin/env python3
"""Iteration 151, item 2 — is any ledger entry stale?

The ledger's `collision` anchors catch "an anchor was rewritten". They cannot
catch "the entry went stale": a new key joins the minority, an overlap set grows,
or a round quietly converges a split without touching either anchor.

This script re-measures every number the ledger's `why` sentences state, using
the caliber each entry declares (`by key` / `by occurrence`), and prints the
recorded number beside the re-measured one so a drift is visible rather than
argued about.

Read-only.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / "packages" / "views" / "locales"


def load(locale):
    bundle = {}
    for path in sorted((LOCALES / locale).glob("*.json")):
        ns = path.stem
        raw = json.loads(path.read_text(encoding="utf8"))

        def walk(value, prefix=""):
            if not isinstance(value, dict):
                bundle[f"{ns}.{prefix}"] = str(value)
                return
            for k, v in value.items():
                walk(v, f"{prefix}.{k}" if prefix else k)

        walk(raw)
    return bundle


EN = load("en")
JA = load("ja")
KO = load("ko")


def by_key(bundle, pattern):
    rx = re.compile(pattern)
    return [k for k, v in bundle.items() if rx.search(v)]


def by_occ(bundle, pattern):
    rx = re.compile(pattern)
    return sum(len(rx.findall(v)) for v in bundle.values())


def report(label, recorded, measured, detail=""):
    flag = "OK " if recorded == measured else "DRIFT"
    print(f"  [{flag}] {label}: recorded={recorded} measured={measured} {detail}")


JA_COUNTERS = (
    "秒|分|時間|日間|日中|日目|日|週間|週|か月|ヶ月|年|件|個|名|回|つ|人|本|枚|台|度|行|文字|ページ|階|時|泊|杯|冊"
)

print("=== Server (ja) ===")
mcp = {k: v for k, v in JA.items() if k.startswith("agents.tab_body.mcp_config.")}
print(f"  surface size: {len(mcp)} keys (recorded 79)")
report("Latin Server in mcp_config", 23, len(by_key(mcp, r"(?<![A-Za-z])Servers?(?![A-Za-z])")))
report("サーバー in mcp_config", 14, len(by_key(mcp, r"サーバー")))
settings_mcp = {k: v for k, v in JA.items() if k.startswith("settings.mcp.")}
named = [k for k, v in settings_mcp.items() if re.search(r"(?<![A-Za-z])Servers?(?![A-Za-z])|サーバー", v)]
native = [k for k in named if "サーバー" in settings_mcp[k]]
print(f"  settings.mcp.*: {len(named)} keys name a server (recorded 20), native {len(native)} (recorded 15)")

print("=== Server (ko) ===")
mcpc = {k: v for k, v in KO.items() if k.startswith("agents.tab_body.mcp_config.")}
report("Latin Server in mcp_config", 23, len(by_key(mcpc, r"(?<![A-Za-z])Servers?(?![A-Za-z])")))
report("서버 in mcp_config", 14, len(by_key(mcpc, r"서버")))
smc = {k: v for k, v in KO.items() if k.startswith("settings.mcp.")}
namedc = [k for k, v in smc.items() if re.search(r"(?<![A-Za-z])Servers?(?![A-Za-z])|서버", v)]
nativec = [k for k in namedc if "서버" in smc[k]]
print(f"  settings.mcp.*: {len(namedc)} keys name a server (recorded 20), native {len(nativec)} (recorded 15)")

print("=== review (ko) ===")
report("검토", 9, len(by_key(KO, r"검토")))
report("리뷰", 8, len(by_key(KO, r"리뷰")))

print("=== label (ko) ===")
report("라벨", 26, len(by_key(KO, r"라벨")))
report("레이블", 25, len(by_key(KO, r"레이블")))

print("=== roles ===")
LATIN_ROLE = r"(?<![A-Za-z])(owner|admin|member)s?(?![A-Za-z])"
for name, bundle, native_rx, rec_lat, rec_nat, rec_both in [
    ("ja", JA, r"(メンバー|オーナー|管理者)", 22, 130, 5),
    ("ko", KO, r"(멤버|소유자|관리자)", 8, 141, 1),
]:
    lat = set(by_key(bundle, LATIN_ROLE))
    nat = set(by_key(bundle, native_rx))
    both = lat & nat
    print(f"  [{name}]")
    report(f"{name} Latin keys", rec_lat, len(lat))
    report(f"{name} native keys", rec_nat, len(nat))
    report(f"{name} overlap", rec_both, len(both), f"(latin-only {len(lat - nat)}, native-only {len(nat - lat)})")
    print(f"      overlap members: {sorted(both)}")

print("=== register (ko) ===")
report("습니다 by key", 856, len(by_key(KO, r"습니다")))
report("해요체 by key", 398, len(by_key(KO, r"(어요|아요|세요|예요|이에요|해요)")))
report("습니다 by occurrence", 895, by_occ(KO, r"습니다"))
report("해요체 by occurrence", 439, by_occ(KO, r"(어요|아요|세요|예요|이에요|해요)"))

print("=== Private (ja) ===")
report("プライベート", 7, len(by_key(JA, r"プライベート")))
report("非公開", 9, len(by_key(JA, r"非公開")))

print("=== figure + counter spacing (ja) — by occurrence ===")
lit_spaced = by_occ(JA, rf"\d\s+(?:{JA_COUNTERS})")
lit_tight = by_occ(JA, rf"\d(?:{JA_COUNTERS})")
report("literal spaced", 42, lit_spaced)
report("literal tight", 14, lit_tight)
ph_spaced = by_occ(JA, rf"\}}\}}\s+(?:{JA_COUNTERS})")
ph_tight = by_occ(JA, rf"\}}\}}(?:{JA_COUNTERS})")
report("placeholder spaced", 155, ph_spaced)
report("placeholder tight", 40, ph_tight)

print("=== counters (ja) ===")
report("エージェント {{n}} 件", 4, len(by_key(JA, r"エージェント\s*\{\{[^}]*\}\}\s*件")))
report("エージェント {{n}} 個", 2, len(by_key(JA, r"エージェント\s*\{\{[^}]*\}\}\s*個")))
report("ツール {{n}} 件", 1, len(by_key(JA, r"ツール\s*\{\{[^}]*\}\}\s*件")))
report("ツール {{n}} 個", 1, len(by_key(JA, r"ツール\s*\{\{[^}]*\}\}\s*個")))
print(f"  ko agents: {sorted(by_key(KO, r'에이전트\\s*\\{\\{[^}]*\\}\\}\\s*개'))}")

print("=== collision anchors still hold ===")
ANCHORS = [
    ("ja", "agents.tab_body.mcp_config.dialog_name_required", "Server"),
    ("ja", "agents.tab_body.mcp_config.dialog_name_locked", "サーバー"),
    ("ko", "agents.tab_body.mcp_config.dialog_name_required", "Server"),
    ("ko", "agents.tab_body.mcp_config.dialog_name_locked", "서버"),
    ("ko", "issues.status.in_review", "리뷰"),
    ("ko", "issues.detail.delegated_subscription_hint", "검토"),
    ("ko", "modals.create_issue.set_labels", "레이블"),
    ("ko", "modals.create_issue.toast_link_labels_failed", "라벨"),
    ("ja", "settings.mcp.admin_only_note", "admin"),
    ("ja", "settings.members.roles.owner.label", "オーナー"),
    ("ko", "settings.mcp.admin_only_note", "owner"),
    ("ko", "settings.workspace.manage_hint", "관리자"),
    ("ko", "common.lark_bind.error_expired", "습니다"),
    ("ko", "common.slack_bind.error_expired", "어요"),
    ("ja", "settings.plugins.private", "プライベート"),
    ("ja", "settings.repositories.github_private", "非公開"),
    ("ja", "autopilots.relative_date.one_day_ago", "1 日"),
    ("ja", "projects.relative_date.one_day_ago", "1日"),
    ("ja", "autopilots.relative_date.months_ago", "}} か月"),
    ("ja", "projects.relative_date.months_ago", "}}か月"),
    ("ja", "agents.runtime_filter.agent_count_other", "件"),
    ("ja", "runtimes.detail.serving_count_other", "個"),
    ("ja", "issues.agent_live.tool_count_other", "件"),
    ("ja", "chat.message_list.tools_other", "個"),
]
BUNDLES = {"ja": JA, "ko": KO}
bad = []
for loc, key, needle in ANCHORS:
    value = BUNDLES[loc].get(key)
    if value is None:
        bad.append(f"{loc}:{key} MISSING")
    elif needle not in value:
        bad.append(f"{loc}:{key} does not contain {needle!r} (got {value!r})")
print("  anchors:", "all hold" if not bad else bad)

print("=== ellipsis split still open in both zh bundles ===")
VIEWS_ZH = load("zh-Hans")
MOBILE_ZH = json.loads((ROOT / "apps/mobile/lib/i18n/locales/zh.json").read_text(encoding="utf8"))
MOBILE_EN = json.loads((ROOT / "apps/mobile/lib/i18n/locales/en.json").read_text(encoding="utf8"))
for name, bundle in [("views zh-Hans", VIEWS_ZH), ("mobile zh", MOBILE_ZH), ("views en", EN), ("mobile en", MOBILE_EN)]:
    dots = len(by_key(bundle, r"\.\.\."))
    ell = len(by_key(bundle, r"…"))
    print(f"  {name}: ... in {dots} keys, … in {ell} keys")
