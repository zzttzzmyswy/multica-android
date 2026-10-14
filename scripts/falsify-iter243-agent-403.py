#!/usr/bin/env python3
"""Mutation-test iteration 243's private-agent no-access face (MYS-2161).

Each mutation injects ONE defect and asserts the suite turns RED on it; the
restore is asserted GREEN. A guard that cannot be made to fail is not a guard —
this is the repo's standing discipline (`scripts/falsify-iter*.py`).

The first four are the ones the acceptance criteria name:

   1. the probe condition written always-true
      -> the common path (agent IS in the list) regains a request per open
   2. 403 and 404 collapsed into one branch
      -> a deleted agent claims the user lacks permission
   3. a network error reported as "no access"
      -> an unreachable server sends the user to ask for a grant they have
   4. the probe fired before the list settled
      -> absent-from-an-arriving list is treated as evidence

The rest are the invariants the fix's own correctness rests on:

   5. the probe hits the LIST endpoint instead of the single-agent one
      -> 200-without-the-row, so no 403 exists to branch on
   6. the probe is never gated at all (fires on every detail open)
   7. the no-access branch is placed AFTER the not-found branch
      -> unreachable, the defect is back
   8. the not-found fallback is replaced by the permission face
      -> a genuinely deleted agent now claims a permission problem
   9. a malformed 200 body throws instead of degrading
      -> schema drift crashes the detail screen
  10. the no-access copy falls back onto the not-found sentence
  11. the i18n key is missing from one bundle
  12. the no-access face loses its way out to the agents list
  13. the 403 status constant is retyped as 404

Run: python3 scripts/falsify-iter243-agent-403.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
LIB = APP / "lib" / "agent-detail-access.ts"
DETAIL = APP / "app" / "(app)" / "[workspace]" / "more" / "agents" / "[id].tsx"
QUERIES = APP / "data" / "queries" / "agents.ts"
API = APP / "data" / "api.ts"
FACE = APP / "components" / "agent" / "agent-no-access.tsx"
ZH = APP / "lib" / "i18n" / "locales" / "zh.json"

SUITE = [
    "lib/agent-detail-access.test.ts",
    "lib/agent-detail-access-wiring.test.ts",
    "data/api-agent-access.test.ts",
    "lib/i18n/iter243-keys.test.ts",
]


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        ["npx", "--no-install", "vitest", "run", *SUITE,
         "--hookTimeout=120000"],
        cwd=APP, capture_output=True, text=True, timeout=900,
    )
    out = proc.stdout + proc.stderr
    green = proc.returncode == 0
    tail = "\n".join(
        line for line in out.splitlines()
        if re.search(r"Tests\s+\d|Test Files\s+\d|error TS", line)
    )
    return green, tail


MUTATIONS: list[tuple[str, Path, str, str]] = [
    (
        "1. the probe condition is effectively always-true",
        LIB,
        """  return listSettled && !agentFound && !!agentId;""",
        """  return listSettled && !!agentId;""",
    ),
    (
        "2. 403 and 404 are collapsed into one branch",
        LIB,
        """    (error as { status?: unknown }).status === AGENT_ACCESS_DENIED_STATUS""",
        """    typeof (error as { status?: unknown }).status === "number" """,
    ),
    (
        "3. a network error (status 0) counts as 'no access'",
        LIB,
        """export function isAgentAccessDenied(error: unknown): boolean {
  return (""",
        """export function isAgentAccessDenied(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === 0
  ) {
    return true;
  }
  return (""",
    ),
    (
        "4. the probe fires before the list has settled",
        LIB,
        """  return listSettled && !agentFound && !!agentId;""",
        """  return !agentFound && !!agentId;""",
    ),
    (
        "5. the probe hits the LIST endpoint instead of the single agent",
        API,
        """    const raw = await this.fetch<unknown>(`/api/agents/${id}`, {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, AgentSchema, EMPTY_AGENT, {
      endpoint: "getAgent",
    });""",
        """    const raw = await this.fetch<unknown>(`/api/agents`, {
      signal: opts?.signal,
    });
    return parseWithFallback(raw, AgentSchema, EMPTY_AGENT, {
      endpoint: "getAgent",
    });""",
    ),
    (
        "6. the probe is enabled unconditionally from the query options",
        QUERIES,
        """    enabled: enabled && !!agentId,""",
        """    enabled: !!agentId,""",
    ),
    (
        "7. the no-access branch is moved AFTER the not-found branch",
        DETAIL,
        """  if (!agent) {
    return (
      <View className="flex-1 justify-center bg-background">
        <CatalogStatus
          state="empty"
          onRetry={read.retry}
          emptyMessage={t("agents.notFound")}
          layout="centered"
        />
      </View>
    );
  }
""",
        """""",
    ),
    (
        "8. the not-found fallback is replaced by the permission face",
        DETAIL,
        """          emptyMessage={t("agents.notFound")}""",
        """          emptyMessage={t("agents.detail.noAccessTitle")}""",
    ),
    (
        "9. a malformed 200 body throws instead of degrading to the fallback",
        API,
        """    return parseWithFallback(raw, AgentSchema, EMPTY_AGENT, {
      endpoint: "getAgent",
    });""",
        """    return AgentSchema.parse(raw);""",
    ),
    (
        "10. the no-access face falls back onto the not-found sentence",
        FACE,
        """        {t("agents.detail.noAccessTitle")}""",
        """        {t("agents.notFound")}""",
    ),
    (
        "11. the new i18n key is absent from the zh bundle",
        ZH,
        """  "agents.detail.noAccessBackToAgents": "返回智能体列表",
""",
        """""",
    ),
    (
        "12. the no-access face loses its way back to the agents list",
        DETAIL,
        """      <AgentNoAccess onBackToAgents={() => router.replace(agentsListHref)} />""",
        """      <AgentNoAccess onBackToAgents={() => {}} />""",
    ),
    (
        "13. the denied status constant is retyped as 404",
        LIB,
        """export const AGENT_ACCESS_DENIED_STATUS = 403;""",
        """export const AGENT_ACCESS_DENIED_STATUS = 404;""",
    ),
    (
        "14. the in-flight gate is dropped, so the probe window shows 'not found'",
        DETAIL,
        """  if (!agent && accessProbe.isFetching) {""",
        """  if (false && accessProbe.isFetching) {""",
    ),
    (
        "15. the in-flight gate keys off isPending, which never clears when disabled",
        DETAIL,
        """  if (!agent && accessProbe.isFetching) {""",
        """  if (!agent && accessProbe.isPending) {""",
    ),
]


def main() -> int:
    green, tail = run_suite()
    print("baseline:", "GREEN" if green else "RED")
    print(tail)
    if not green:
        print("!! baseline is already red — fix before mutating")
        return 1

    failures: list[str] = []
    for name, path, old, new in MUTATIONS:
        original = path.read_text()
        if old not in original:
            print(f"[SKIP] {name}: anchor not found in {path.name}")
            failures.append(name)
            continue
        path.write_text(original.replace(old, new, 1))
        try:
            mutated_green, _ = run_suite()
        finally:
            path.write_text(original)
        if mutated_green:
            print(f"[MISS] {name}: suite stayed GREEN")
            failures.append(name)
        else:
            print(f"[OK]   {name}: turned RED")
        # The restore must itself be green, or the mutation's verdict is junk.
        restored_green, _ = run_suite()
        if not restored_green:
            print(f"[BAD]  {name}: restore did not return to GREEN")
            failures.append(name)

    print()
    if failures:
        print(f"{len(failures)}/{len(MUTATIONS)} did not hold:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"all {len(MUTATIONS)} mutations turned RED and restored GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
