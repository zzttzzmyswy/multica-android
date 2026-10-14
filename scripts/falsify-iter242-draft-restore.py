#!/usr/bin/env python3
"""Mutation-test iteration 242's cancelled-prompt restore guards (#5219).

Each mutation injects ONE defect and asserts the suite turns RED on it; the
restore is asserted GREEN. A guard that cannot be made to fail is not a guard —
this is the repo's standing discipline (`scripts/falsify-iter*.py`).

The first five are the ones the acceptance criteria name. The rest are the
invariants the new code's own correctness rests on:

   1. the cancel stops declaring the capability            -> server takes the
      legacy branch and the durable row is never written
   2. a synchronous `restore_to_input` is read but not
      fed back to the composer                             -> the prompt is lost
   3. the durable consume fires BEFORE the composer has
      the text                                             -> order inverted,
      the row is gone with nothing on screen
   4. a restore addressed at another session is applied
      anyway                                               -> text lands in the
      wrong chat
   5. the cancel response is not parsed (the original bug) -> body discarded
   6. the composer reports the hand-off before writing      -> consume for a
      hand-off it never made
   7. the ledger entry is dropped on a failed consume       -> a sent prompt is
      offered again after a restart
   8. a pending restore overwrites work in progress         -> the user's draft
      is destroyed by the recovery
   9. the post-write ledger step is skipped for durable rows -> at-most-once
      guarantee gone

Run: python3 scripts/falsify-iter242-draft-restore.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
LIB = APP / "lib" / "chat-draft-restore.ts"
CONSUMER = APP / "lib" / "chat-draft-restore-consumer.ts"
HOOK = APP / "lib" / "use-chat-draft-restore.ts"
STORE = APP / "data" / "stores" / "chat-draft-restore-store.ts"
API = APP / "data" / "api.ts"
CHAT = APP / "app" / "(app)" / "[workspace]" / "(tabs)" / "chat.tsx"
COMPOSER = APP / "components" / "composer" / "message-composer.tsx"
UPDATERS = APP / "data" / "realtime" / "chat-ws-updaters.ts"
MUT_CHAT = APP / "data" / "mutations" / "chat.ts"
BUILDER = APP / "components" / "agent" / "builder-workspace.tsx"

SUITE = [
    "lib/chat-draft-restore.test.ts",
    "lib/chat-draft-restore-consumer.test.ts",
    "lib/chat-draft-restore-wiring.test.ts",
    "data/api-chat-draft-restore.test.ts",
    "data/stores/chat-draft-restore-store.test.ts",
    "data/realtime/chat-ws-updaters.test.ts",
]


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        ["npx", "--no-install", "vitest", "run", "--root", "apps/mobile",
         *SUITE, "--hookTimeout=120000"],
        cwd=ROOT, capture_output=True, text=True, timeout=900,
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
        "1. the cancel no longer declares the capability",
        API,
        '''      headers: {
        "X-Client-Capabilities": CHAT_DRAFT_RESTORE_CAPABILITY,
      },''',
        '''      headers: {},''',
    ),
    (
        "2. a synchronous restore_to_input is read but never fed back",
        LIB,
        """  const restore =
    cancelled.restore_to_input &&
    !args.queuedAction &&
    args.restoreDraftToInput &&
    cancelled.chat_session_id === args.sessionId""",
        """  const restore =
    false &&
    !args.queuedAction &&
    args.restoreDraftToInput &&
    cancelled.chat_session_id === args.sessionId""",
    ),
    (
        "3. the durable row is consumed the moment it is OFFERED, not applied",
        HOOK,
        """    const row = pickPendingRestore(
      restores,
      activeSessionId,
      appliedRestoreIds,
    );
    if (!row) return;""",
        """    const row = pickPendingRestore(
      restores,
      activeSessionId,
      appliedRestoreIds,
    );
    if (!row) return;
    consumer.applyTerminal({
      id: row.id,
      content: row.content ?? "",
      sessionId: row.chat_session_id,
      serverRestoreId: row.id,
    });""",
    ),
    (
        "4. a restore addressed at another session is applied anyway",
        LIB,
        """  if (request.sessionId && request.sessionId !== args.draftKey) {
    return "wait-session";
  }""",
        """  if (false && request.sessionId !== args.draftKey) {
    return "wait-session";
  }""",
    ),
    (
        "5. the cancel response body is discarded again (the original bug)",
        API,
        """    return parseWithFallback(
      raw,
      CancelTaskResponseSchema,
      EMPTY_CANCEL_TASK_RESPONSE,
      { endpoint: "POST /api/tasks/{id}/cancel" },
    );""",
        """    return EMPTY_CANCEL_TASK_RESPONSE;""",
    ),
    (
        "6. the composer reports the hand-off before writing the draft",
        COMPOSER,
        """    appliedRestoreIdRef.current = restoreId;
    setText(restoreRequest.content);""",
        """    appliedRestoreIdRef.current = restoreId;
    onRestoreApplied?.();
    setText(restoreRequest.content);""",
    ),
    (
        "7. a failed consume drops its ledger entry, re-arming the restore",
        CONSUMER,
        """      .catch((err: unknown) => {""",
        """      .catch((err: unknown) => {
        deps.forgetApplied(restoreId);""",
    ),
    (
        "8. a pending restore overwrites the user's work in progress",
        COMPOSER,
        """    if (busy) return;""",
        """    if (false) return;""",
    ),
    (
        "9. the durable restore is settled without ever being recorded",
        CONSUMER,
        """    if (serverRestoreId && sessionId) {
      deps.markApplied(serverRestoreId);
      consume(sessionId, serverRestoreId);""",
        """    if (serverRestoreId && sessionId) {
      consume(sessionId, serverRestoreId);""",
    ),
    (
        "10. the deleted bubble is left rendered after the server deleted it",
        UPDATERS,
        """  qc.setQueryData<ChatMessage[]>(chatKeys.messages(sessionId), (old) =>
    old ? old.filter((m) => m.id !== messageId) : old,
  );""",
        """  void qc;""",
    ),
    (
        "11. the deferred-outcome event is ignored, so a restored prompt is never re-pulled",
        UPDATERS,
        """  if (plan.refetchDraftRestores) {
    void qc.invalidateQueries({ queryKey: chatKeys.draftRestores(sessionId) });
  }""",
        """  if (false) {
    void qc.invalidateQueries({ queryKey: chatKeys.draftRestores(sessionId) });
  }""",
    ),
    (
        "12. the ledger is not persisted, so a restart re-offers a sent prompt",
        STORE,
        """        const next = markRestoreApplied(current, restoreId);
        if (next === current) return s;
        persist(wsId, next, s.queueByWorkspace[wsId] ?? {});""",
        """        const next = markRestoreApplied(current, restoreId);
        if (next === current) return s;""",
    ),
    (
        "13. the queued-edit writes locally invented text instead of the server's copy",
        CHAT,
        """        if (plan.restore) {
          setDraft(sessionId, plan.restore.content);""",
        """        if (plan.restore) {
          setDraft(sessionId, queueEditDraftText(task) ?? t("chat.queue.fallback"));""",
    ),
    (
        "14. the stop path no longer reads the response (the void call returns)",
        CHAT,
        """        const plan = planCancelRestore(result.cancelled_chat_message, {
          sessionId,
          restoreDraftToInput: true,
        });
        // The server really deleted that message; leaving the bubble up would
        // render a prompt that no longer exists.
        if (plan.removeMessageId) {
          removeChatMessageFromCache(qc, sessionId, plan.removeMessageId);
        }
        if (plan.restore) enqueueLocalRestore(plan.restore);""",
        """        void result;""",
    ),
    (
        "15. the session-menu stop goes back to discarding the response",
        MUT_CHAT,
        """    onSuccess: (result, { sessionId }) => {
      const plan = planCancelRestore(result.cancelled_chat_message, {
        sessionId,
        restoreDraftToInput: true,
      });
      if (plan.removeMessageId) {
        removeChatMessageFromCache(qc, sessionId, plan.removeMessageId);
      }
      if (plan.restore) enqueueLocalRestore(plan.restore);
    },""",
        """    onSuccess: () => {},""",
    ),
    (
        "16. the agent-builder composer discards the response again",
        BUILDER,
        """        if (plan.removeMessageId) {
          removeChatMessageFromCache(qc, sessionId, plan.removeMessageId);
        }
        if (plan.restore) setComposer(plan.restore.content);""",
        """        void plan;""",
    ),
    (
        "17. the queued-remove leaves the deleted bubble rendered",
        CHAT,
        """        if (plan.removeMessageId) {
          removeChatMessageFromCache(qc, sessionId, plan.removeMessageId);
        }
      } finally {
        patchPending((old) => removePendingChatTask(old, task.task_id));
        invalidatePendingTask(qc, sessionId);
      }
    },
    [activeSessionId, patchPending, qc],
  );""",
        """      } finally {
        patchPending((old) => removePendingChatTask(old, task.task_id));
        invalidatePendingTask(qc, sessionId);
      }
    },
    [activeSessionId, patchPending, qc],
  );""",
    ),
]


def apply(path: Path, old: str, new: str) -> bool:
    src = path.read_text()
    if old not in src:
        print(f"    !! anchor not found in {path.relative_to(ROOT)}", flush=True)
        return False
    path.write_text(src.replace(old, new, 1))
    return True


def main() -> int:
    print("== baseline (must be GREEN) ==", flush=True)
    green, tail = run_suite()
    print(tail, flush=True)
    if not green:
        print("BASELINE IS RED — aborting.", flush=True)
        return 1

    failures: list[str] = []
    for name, path, old, new in MUTATIONS:
        if old == new:
            print(f"== {name} == SKIPPED (no-op mutation)", flush=True)
            continue
        original = path.read_text()
        print(f"== {name} ==", flush=True)
        if not apply(path, old, new):
            failures.append(f"{name} (anchor missing)")
            continue
        try:
            green_after, tail = run_suite()
        finally:
            path.write_text(original)
        if green_after:
            print("    NOT CAUGHT — the suite stayed green on a defect.", flush=True)
            failures.append(name)
        else:
            print(f"    caught: {tail.splitlines()[0] if tail else 'red'}", flush=True)

    print("== restore check (must be GREEN again) ==", flush=True)
    green, tail = run_suite()
    print(tail, flush=True)
    if not green:
        print("RESTORE LEFT THE TREE RED — a mutation was not undone.", flush=True)
        return 1

    if failures:
        print(f"\n{len(failures)} mutation(s) survived:", flush=True)
        for f in failures:
            print(f"  - {f}", flush=True)
        return 1
    print(f"\nAll {len(MUTATIONS)} mutations caught; tree restored green.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
