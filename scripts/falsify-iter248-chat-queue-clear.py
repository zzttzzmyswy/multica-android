#!/usr/bin/env python3
"""Mutation-test iteration 248's "clear queue" ghost-bubble fix (MYS-2177).

The defect is a WIRING + ORDERING gap, the kind that half-fixes very easily:
emptying `queued_tasks` DOES make the queue card disappear, so the screen looks
fixed while the server-deleted prompts are still sitting in the flat messages
cache — and `hideQueuedChatMessages` stops filtering them the instant the queue
empties, so they reappear. Every mutation below injects ONE such half-defect and
asserts the suite turns RED; the restore is asserted GREEN. A guard that cannot
be made to fail is not a guard — the repo's standing discipline
(`scripts/falsify-*.py`).

The acceptance criteria name these half-fix shapes:

   1. the queue is emptied and the bubbles are never evicted (the pre-fix code)
   2. the eviction targets the wrong id, so it deletes nothing
   3. the doomed list is read AFTER the request instead of before it
      (web's literal ordering; an in-flight pending refetch blanks it -> dead code)
   4. the whole pendingTask is cleared instead of just its queue
      (the unclaimed FIFO head is still current server-side)
   5. the in-flight pending refetch is not cancelled before the DELETE
   6. `messages` is not invalidated in `finally` — the pre-fix failure mode
   7. `messagesPage` IS invalidated, copying web's infinite-query shape
   8. a failed clear still looks cleared (the rejection is swallowed)
   9. the bubbles are evicted AFTER the queue is emptied (visible flicker)

And the call-site ones (the wiring layer is where the original bug lived):

  10. the chat screen ships the shallow `queued_tasks: []` clear again
  11. the chat screen bypasses the helper and calls the API directly
  12. the workspace aggregate is left stale on clear

Run: python3 scripts/falsify-iter248-chat-queue-clear.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
QUEUE = APP / "lib" / "chat-queue-clear.ts"
CHAT = APP / "app" / "(app)" / "[workspace]" / "(tabs)" / "chat.tsx"

SUITE = [
    "lib/chat-queue-clear.test.ts",
    "lib/chat-queue-clear-wiring.test.ts",
]

# The exact pre-fix body, kept verbatim so mutation 10 restores the bug the
# iteration set out to kill rather than a paraphrase of it.
CURRENT_CLEAR = """  const handleQueueClear = useCallback(async () => {
    if (!activeSessionId) return;
    // 清空不只发生在 pendingTask 缓存里：被滤掉的排队气泡本体仍在 messages
    // 缓存中，队列一空它们就会以「服务端已删」的状态重新现身。收尾逻辑
    // （摘要清单 → 摘气泡 → 清队列 → 失效）集中在 lib/chat-queue-clear.ts，
    // 与 web handleClearQueuedTasks 同序。失败时抛给 ChatQueue 弹 Alert。
    await clearChatQueue(qc, activeSessionId, wsId);
  }, [activeSessionId, qc, wsId]);"""

PRE_FIX_CLEAR = """  const handleQueueClear = useCallback(async () => {
    if (!activeSessionId) return;
    const sessionId = activeSessionId;
    try {
      await api.clearQueuedChatTasks(sessionId);
      patchPending((old) => (old ? { ...old, queued_tasks: [] } : {}));
    } finally {
      invalidatePendingTask(qc, sessionId);
    }
  }, [activeSessionId, patchPending, qc]);"""


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
        "1. the queue is emptied and the bubbles are never evicted",
        QUEUE,
        "    for (const messageId of doomedMessageIds) {\n"
        "      removeChatMessageFromCache(qc, sessionId, messageId);\n"
        "    }\n",
        "    void doomedMessageIds;\n",
    ),
    (
        "2. the eviction targets the task id, so it deletes nothing",
        QUEUE,
        "    task.message_id ? [task.message_id] : [],",
        "    task.message_id ? [task.task_id] : [],",
    ),
    (
        "3. the doomed list is read AFTER the request (web's literal ordering)",
        QUEUE,
        "  const doomedMessageIds = queuedMessageIdsToEvict(\n"
        "    qc.getQueryData<ChatPendingTask>(pendingKey),\n"
        "  );\n"
        "  try {\n"
        "    await api.clearQueuedChatTasks(sessionId);\n",
        "  const doomedMessageIds: string[] = [];\n"
        "  try {\n"
        "    await api.clearQueuedChatTasks(sessionId);\n"
        "    doomedMessageIds.push(\n"
        "      ...queuedMessageIdsToEvict(qc.getQueryData<ChatPendingTask>(pendingKey)),\n"
        "    );\n",
    ),
    (
        "4. the whole pendingTask is cleared, losing the unclaimed head",
        QUEUE,
        "  return (old?.queued_tasks ?? []).reduce<ChatPendingTask>(\n"
        "    (current, task) => removePendingChatTask(current, task.task_id),\n"
        "    old ?? {},\n"
        "  );",
        "  void old;\n"
        "  return {};",
    ),
    (
        "5. the in-flight pending refetch is not cancelled first",
        QUEUE,
        "  await qc.cancelQueries({ queryKey: pendingKey });\n",
        "",
    ),
    (
        "6. `messages` is not invalidated — the pre-fix failure mode",
        QUEUE,
        "    qc.invalidateQueries({ queryKey: pendingKey });\n"
        "    qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });\n",
        "    qc.invalidateQueries({ queryKey: pendingKey });\n",
    ),
    (
        "7. messagesPage IS invalidated, copying web's infinite-query shape",
        QUEUE,
        "    qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });\n",
        "    qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });\n"
        "    qc.invalidateQueries({ queryKey: chatKeys.messagesPage(sessionId) });\n",
    ),
    (
        "8. a failed clear still looks cleared (the rejection is swallowed)",
        QUEUE,
        "    console.warn(\"[chat] clear queued tasks failed\", { sessionId, err });\n"
        "    throw err;\n",
        "    console.warn(\"[chat] clear queued tasks failed\", { sessionId, err });\n",
    ),
    (
        "9. the bubbles are evicted AFTER the queue is emptied",
        QUEUE,
        "    for (const messageId of doomedMessageIds) {\n"
        "      removeChatMessageFromCache(qc, sessionId, messageId);\n"
        "    }\n"
        "    qc.setQueryData<ChatPendingTask>(pendingKey, (old) =>\n"
        "      clearQueuedTasksInPending(old),\n"
        "    );\n",
        "    qc.setQueryData<ChatPendingTask>(pendingKey, (old) =>\n"
        "      clearQueuedTasksInPending(old),\n"
        "    );\n"
        "    for (const messageId of doomedMessageIds) {\n"
        "      removeChatMessageFromCache(qc, sessionId, messageId);\n"
        "    }\n",
    ),
    (
        "10. the chat screen ships the shallow clear again (the original bug)",
        CHAT,
        CURRENT_CLEAR,
        PRE_FIX_CLEAR,
    ),
    (
        "11. the chat screen bypasses the helper and calls the API directly",
        CHAT,
        "    await clearChatQueue(qc, activeSessionId, wsId);\n",
        "    await api.clearQueuedChatTasks(activeSessionId);\n",
    ),
    (
        "12. the workspace aggregate is left stale on clear",
        CHAT,
        "    await clearChatQueue(qc, activeSessionId, wsId);\n",
        "    await clearChatQueue(qc, activeSessionId);\n",
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
