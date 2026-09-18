#!/usr/bin/env python3
"""Falsify every rule this round added: inject one defect per rule, confirm the
guard actually fails on it, then restore. A guard that only ever passes proves
nothing — this is the round's counter-evidence.

Run from the repo root: python3 scripts/falsify-iter142-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps/mobile"

VIEWS_TEST = "packages/views/locales/zh-glossary.test.ts"
MOBILE_TEST = "lib/i18n/zh-glossary.test.ts"
LIB_TEST = "lib/inbox-item-source.test.ts"
GATE_TEST = "lib/workspace-gate.test.ts"

V_AGENTS = ROOT / "packages/views/locales/zh-Hans/agents.json"
V_SETTINGS = ROOT / "packages/views/locales/zh-Hans/settings.json"
M_ZH = MOBILE / "lib/i18n/locales/zh.json"
M_LIB = MOBILE / "lib/inbox-item-source.ts"
M_GATE = MOBILE / "lib/workspace-gate.ts"

# (label, file, old, new, cwd, test_file, test_name_that_must_fail)
CASES = [
    (
        "views: unclassified Latin token is caught",
        V_AGENTS, '"已添加 MCP 服务器"', '"已添加 MCP Server"',
        ROOT, VIEWS_TEST, "classifies every surviving Latin token",
    ),
    (
        "views: an exception that no longer occurs is caught",
        V_SETTINGS, '"搜索 toolkit…"', '"搜索工具包…"',
        ROOT, VIEWS_TEST, "keeps every exception real",
    ),
    (
        "views: bare 服务 on an MCP surface is caught",
        V_SETTINGS, '"添加服务器"', '"添加服务"',
        ROOT, VIEWS_TEST, "never renders an MCP server as a bare 服务",
    ),
    (
        "views: restoring a translated word is caught",
        V_AGENTS, '"这是历史遗留的提供方原生格式', '"这是历史 Provider 原生格式',
        ROOT, VIEWS_TEST, "keeps the settled Chinese words this round chose",
    ),
    (
        "mobile: unclassified Latin token is caught",
        M_ZH, "统一 14 个处理器的错误响应格式", "统一 14 个 handler 的错误响应格式",
        MOBILE, MOBILE_TEST, "classifies every surviving Latin token",
    ),
    (
        "mobile: an exception that no longer occurs is caught",
        M_ZH, '"迁移 issue handler"', '"迁移 issue 处理器"',
        MOBILE, MOBILE_TEST, "keeps every exception real",
    ),
    (
        "mobile: prose handler reverting to English is caught",
        M_ZH, "已完成 12/14 个处理器", "已完成 12/14 个 handler",
        MOBILE, MOBILE_TEST, "renders the demo prose handler as 处理器",
    ),
    (
        "mobile: the settled MCP server word drifting back is caught",
        M_ZH, '"common.server": "服务器"', '"common.server": "Server"',
        MOBILE, MOBILE_TEST, "keeps the MCP server word the mobile bundle settled",
    ),
    (
        "inbox-item: the cold-start window rendering as missing is caught",
        M_LIB,
        '  if (!input.workspaceReady || input.fetching) return "loading";\n',
        "",
        MOBILE, LIB_TEST, "waits while the workspace id is still resolving",
    ),
    (
        "inbox-item: fetching the fallback before the primary settles is caught",
        M_LIB,
        "return input.workspaceReady && input.primarySettled && !input.hasPrimaryItem;",
        "return input.workspaceReady && !input.hasPrimaryItem;",
        MOBILE, LIB_TEST, "does not fetch the fallback while the primary list is still in flight",
    ),
    (
        "inbox-item: reading the wrong list first is caught",
        M_LIB,
        'return [primary, primary === "archived" ? "inbox" : "archived"];',
        'return [primary, primary];',
        MOBILE, LIB_TEST, "keeps the other list as a fallback for both views",
    ),
    (
        "workspace-gate: children mounting before the store syncs is caught",
        M_GATE,
        '  if (state.currentWorkspaceId !== state.matchedId) return "loading";\n',
        "",
        MOBILE, GATE_TEST, "waits while the matched workspace's id has not reached the store yet",
    ),
    (
        "workspace-gate: redirecting a cold deep link away is caught",
        M_GATE,
        '  if (state.isLoading) return "loading";\n',
        '  if (!state.matchedId) return "redirect";\n  if (state.isLoading) return "loading";\n',
        MOBILE, GATE_TEST, "prefers waiting over redirecting",
    ),
]


def run(cwd: Path, test_file: str) -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", test_file, "--reporter=verbose"],
        cwd=cwd, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


failures = []
for label, path, old, new, cwd, test_file, must_fail in CASES:
    src = path.read_text(encoding="utf-8")
    if src.count(old) < 1:
        failures.append(f"{label}: injection anchor not found in {path.name}")
        continue
    path.write_text(src.replace(old, new, 1), encoding="utf-8")
    try:
        out = run(cwd, test_file)
    finally:
        path.write_text(src, encoding="utf-8")

    hit = any(
        must_fail in line and ("×" in line or "✗" in line)
        for line in out.splitlines()
    )
    status = "OK  " if hit else "MISS"
    if not hit:
        failures.append(f"{label}: guard stayed green (looked for {must_fail!r})")
    print(f"{status} {label}")

# Restore-check: everything must be green again.
print("\n-- restored state --")
for cwd, test_file in [(ROOT, VIEWS_TEST), (MOBILE, MOBILE_TEST), (MOBILE, LIB_TEST), (MOBILE, GATE_TEST)]:
    out = run(cwd, test_file)
    ok = "failed" not in out.split("Test Files")[-1].split("\n")[0]
    print(f"{'OK  ' if ok else 'FAIL'} {test_file}")
    if not ok:
        failures.append(f"{test_file} did not return to green after restore")

if failures:
    print("\nFAILURES:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("\nAll rules falsified, all bundles restored green.")
