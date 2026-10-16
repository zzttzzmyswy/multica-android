#!/usr/bin/env python3
"""Mutation-test iteration 250's "cross-device archive reaches the phone's row"
fix (MYS-2183).

The defect is a partially-applied realtime payload, and that shape half-fixes
very easily: adding `status` alone moves the row into the archived bucket, so
the screen LOOKS fixed while the row's red dot and its share of the Chat tab
badge stay lit — permanently, because `staleTime` is Infinity and nothing
refetches. Adding the zeroing alone leaves the row in the history list. Each
mutation injects exactly ONE such half-defect and asserts the suite turns RED;
the restore is asserted GREEN. A guard that cannot be made to fail is not a
guard — the repo's standing discipline (`scripts/falsify-*.py`).

The shapes, mirroring the issue's acceptance criteria:

   1. only `status` is added, unread is NOT zeroed        (badge stays lit)
   2. unread IS zeroed but `status` is not applied        (row stays in history)
   3. only the zeroing is added, no `status` at all
   4. `payload.status ?? "active"`                        (never archives)
   5. the narrow type is completed but the patcher never consumes `status`
   6. the zeroing condition is inverted (`status === "active"`)
   7. `project_id` judged by `!== undefined`              (explicit null lost)
   8. `has_unread` cleared but `unread_count` left        (tab badge stays lit)
   9. the zeroing lands on the wrong session's row
  10. the plan re-narrows the payload inline, dropping `status` again
      (the pre-fix shape, re-created at the call site)
  11. the plan stops calling the patcher at all
  12. the local archive mutation stops zeroing unread (web's window reopens)
  13. the local archive mutation drops its pure-patch call and re-inlines the
      pre-fix body (the fixed helper shadowed)
  14. the plan is never mounted: the layout stops subscribing

Run: python3 scripts/falsify-iter250-chat-session-updated-parity.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
PLAN = APP / "data" / "realtime" / "chat-sessions-subscriptions.ts"
UPDATERS = APP / "data" / "realtime" / "chat-ws-updaters.ts"
MUTATIONS = APP / "data" / "mutations" / "chat.ts"
LAYOUT = APP / "app" / "(app)" / "[workspace]" / "_layout.tsx"

SUITE = [
    "data/realtime/chat-session-archive-parity.test.ts",
    "lib/chat-session-archive.test.ts",
    "lib/chat-session-archive-wiring.test.ts",
    "data/realtime/chat-ws-updaters.test.ts",
    "data/realtime/chat-sessions-subscriptions.test.ts",
]

# The fixed archive branch, verbatim, so mutations 1/3/6/8/9 restore the exact
# pre-fix shape the iteration set out to kill rather than a paraphrase of it.
CURRENT_ARCHIVE = """            ...(payload.status !== undefined ? { status: payload.status } : {}),
            ...(payload.updated_at !== undefined
              ? { updated_at: payload.updated_at }
              : {}),
            ...(payload.status === "archived"
              ? { unread_count: 0, has_unread: false }
              : {}),"""

ZERO_LINE = """            ...(payload.status === "archived"
              ? { unread_count: 0, has_unread: false }
              : {}),
"""

PRESENCE_LINE = '            ...("project_id" in payload\n'


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
        "1. only `status` is applied — unread is never zeroed",
        UPDATERS,
        ZERO_LINE,
        "",
    ),
    (
        "2. unread IS zeroed but `status` is never applied",
        UPDATERS,
        '            ...(payload.status !== undefined ? { status: payload.status } : {}),\n',
        "",
    ),
    (
        "3. only the zeroing is added — no `status` branch at all",
        UPDATERS,
        CURRENT_ARCHIVE,
        """            ...(payload.updated_at !== undefined
              ? { updated_at: payload.updated_at }
              : {}),
            ...(payload.status === "archived"
              ? { unread_count: 0, has_unread: false }
              : {}),""",
    ),
    (
        '4. `payload.status ?? "active"` — an archived row reads as active',
        UPDATERS,
        "{ status: payload.status }",
        '{ status: payload.status ?? "active" }',
    ),
    (
        "5. the payload type is complete but the patcher ignores `status`",
        UPDATERS,
        '            ...(payload.status !== undefined ? { status: payload.status } : {}),\n'
        '            ...(payload.updated_at !== undefined\n'
        '              ? { updated_at: payload.updated_at }\n'
        '              : {}),\n'
        '            ...(payload.status === "archived"\n'
        '              ? { unread_count: 0, has_unread: false }\n'
        '              : {}),',
        """            ...(payload.updated_at !== undefined
              ? { updated_at: payload.updated_at }
              : {}),
            ...((payload as { status?: "archived" }).status === "archived"
              ? { unread_count: 0, has_unread: false }
              : {}),""",
    ),
    (
        "6. the zeroing condition is inverted (`status === \"active\"`)",
        UPDATERS,
        'payload.status === "archived"',
        'payload.status === "active"',
    ),
    (
        "7. `project_id` judged by `!== undefined` — an explicit null is lost",
        UPDATERS,
        PRESENCE_LINE + '              ? { project_id: payload.project_id }\n'
        '              : {}),',
        "            ...(payload.project_id !== undefined\n"
        "              ? { project_id: payload.project_id }\n"
        "              : {}),",
    ),
    (
        "8. `has_unread` cleared but `unread_count` left behind",
        UPDATERS,
        "{ unread_count: 0, has_unread: false }",
        "{ has_unread: false }",
    ),
    (
        "9. the zeroing spills onto every OTHER row (target excluded)",
        UPDATERS,
        "    return sortChatSessions(next);",
        """    return sortChatSessions(
      next.map((s) =>
        s.id === payload.chat_session_id
          ? s
          : payload.status === "archived"
            ? { ...s, unread_count: 0, has_unread: false }
            : s,
      ),
    );""",
    ),
    (
        "10. the plan re-narrows the payload inline, dropping `status` again",
        PLAN,
        "      const payload = p as ChatSessionUpdatedPayload;",
        """      const payload = p as {
        chat_session_id: string;
        title?: string;
        updated_at?: string;
        pinned?: boolean;
      };""",
    ),
    (
        "11. the plan stops calling the patcher",
        PLAN,
        "      patchSessionListAfterUpdate(qc, wsId, payload);",
        "",
    ),
    (
        "12. the local archive mutation stops zeroing unread",
        ROOT / "apps" / "mobile" / "lib" / "chat-session-archive.ts",
        '          ...(archived ? { unread_count: 0, has_unread: false } : {}),\n',
        "",
    ),
    (
        "13. the local archive mutation re-inlines the pre-fix body",
        MUTATIONS,
        "      qc.setQueryData<ChatSession[]>(\n"
        "        key,\n"
        "        setChatSessionArchivedPatch(prev, id, archived),\n"
        "      );",
        """      qc.setQueryData<ChatSession[]>(key, (old) =>
        old?.map((s) =>
          s.id === id ? { ...s, status: archived ? "archived" : "active" } : s,
        ),
      );""",
    ),
    (
        "14. the plan is never mounted (the layout stops subscribing)",
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
