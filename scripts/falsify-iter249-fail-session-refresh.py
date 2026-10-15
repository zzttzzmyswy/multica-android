#!/usr/bin/env python3
"""Mutation-test iteration 249's "failed turn refreshes the session list" fix
(MYS-2178).

The defect is a MISSING INVALIDATION on one of four terminal branches, and that
shape half-fixes very easily: the failure bubble already appears in the
transcript (a different cache, invalidated by the per-session hook), so the
screen looks fixed while the session row keeps the pre-failure preview and a
zero unread badge — permanently, because `staleTime` is Infinity. Every
mutation injects ONE such half-defect and asserts the suite turns RED; the
restore is asserted GREEN. A guard that cannot be made to fail is not a guard —
the repo's standing discipline (`scripts/falsify-*.py`).

The shapes, mirroring the issue's acceptance criteria:

   1. the pre-fix branch: task:failed only refreshes the pending aggregate
   2. the wrong key is invalidated (messages instead of the session list)
   3. the invalidation lands on task:completed and NOT on task:failed
      (the event / helper mismatch)
   4. the invalidation is gated away entirely (unreachable branch)
   5. the gate is inverted — non-chat failures refetch, chat ones do not
   6. the helper is called with the wrong workspace id
   7. the gate reads the task id instead of the session id
   8. the hook re-inlines its own copy of the list, leaving the fixed plan
      unreached (the pre-fix behaviour shadowing the fix)
   9. the plan is never mounted: the layout stops subscribing

Run: python3 scripts/falsify-iter249-fail-session-refresh.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
PLAN = APP / "data" / "realtime" / "chat-sessions-subscriptions.ts"
HOOK = APP / "data" / "realtime" / "use-chat-sessions-realtime.ts"
LAYOUT = APP / "app" / "(app)" / "[workspace]" / "_layout.tsx"

SUITE = [
    "data/realtime/chat-sessions-subscriptions.test.ts",
    "lib/chat-session-failure-refresh-wiring.test.ts",
]

# The fixed failure branch, verbatim, so mutation 1 restores the exact shape
# the iteration set out to kill rather than a paraphrase of it.
CURRENT_FAILED = """    ws.on("task:failed", (payload) => {
      invalidatePendingTasks();
      if (payload.chat_session_id) invalidateSessions();
    }),"""

PRE_FIX_FAILED = """    ws.on("task:failed", invalidatePendingTasks),"""


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        ["npx", "--no-install", "vitest", "run", *SUITE, "--hookTimeout=120000"],
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
        "1. the pre-fix branch: task:failed only refreshes the aggregate",
        PLAN,
        CURRENT_FAILED,
        PRE_FIX_FAILED,
    ),
    (
        "2. the wrong key is invalidated (messages, not the session list)",
        PLAN,
        "      if (payload.chat_session_id) invalidateSessions();\n",
        "      if (payload.chat_session_id)\n"
        "        qc.invalidateQueries({ queryKey: chatKeys.messages(\"x\") });\n",
    ),
    (
        "3. the invalidation MOVES onto task:completed and off task:failed",
        PLAN,
        CURRENT_FAILED,
        """    ws.on("task:completed", (payload) => {
      invalidatePendingTasks();
      if (payload.chat_session_id) invalidateSessions();
    }),
    ws.on("task:failed", invalidatePendingTasks),""",
    ),
    (
        "4. the invalidation is unreachable (gate can never be satisfied)",
        PLAN,
        "      if (payload.chat_session_id) invalidateSessions();\n",
        "      if (payload.task_id && payload.chat_session_id) invalidateSessions();\n"
        "      if (false) invalidateSessions();\n",
    ),
    (
        "5. the gate is inverted: non-chat failures refetch instead",
        PLAN,
        "      if (payload.chat_session_id) invalidateSessions();\n",
        "      if (!payload.chat_session_id) invalidateSessions();\n",
    ),
    (
        "6. the helper is called for the wrong workspace",
        PLAN,
        "  const invalidateSessions = () =>\n"
        "    qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });\n",
        "  const invalidateSessions = () =>\n"
        "    qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId + \"-other\") });\n",
    ),
    (
        "7. the gate reads the task id instead of the session id",
        PLAN,
        "      if (payload.chat_session_id) invalidateSessions();\n",
        "      if (payload.task_id) invalidateSessions();\n",
    ),
    (
        "8. the hook re-inlines the list, leaving the fixed plan unreached",
        HOOK,
        "    (ws, wsId) => planChatSessionsSubscriptions(qc, ws, wsId),",
        """    (ws, wsId) => [
      ws.on("task:failed", () => {
        qc.invalidateQueries({ queryKey: chatKeys.pendingTasks(wsId) });
      }),
    ],""",
    ),
    (
        "9. the plan is never mounted (the layout stops subscribing)",
        LAYOUT,
        "  useChatSessionsRealtime();\n",
        "",
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
