#!/usr/bin/env python3
"""Mutation-test iteration 265's two fixes (MYS-2294).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, scripts/falsify-*.py).

The two gaps this round closes, and what the mutations attack:

  #1  `deferred` was a status the client could not name. The server's CHECK
      constraint has carried it since migration 128, `CreateRetryTask` writes
      it with a `fire_at`, and `ListTasksByIssue` filters on nothing but
      `issue_id` — so it really arrives. The schema's enum omitted it and
      ended in `.catch("queued")`, so a parked retry was relabelled as queued
      and rendered as active work. Mutations: put the enum back the way it
      was, drop one of the three exhaustive status maps, let the runs sheet's
      Active section take whatever the endpoint returns, let Past include it,
      count it as a run in the usage breakdown, and add it to the timeline.

  #2  The archive's deep link could not resolve past the first page. Both
      list reads are bounded (legacy: `LIMIT 200` groups; paged: page one
      only here) against 1,287 archived groups on this deployment, so a link
      into the middle of the archive rendered 「这条通知已不可用。」. The
      `inbox-item/[id]` screen now asks the server for the group directly.
      Mutations: hang the lookup off the cursor chain, drop the `group_id`
      parameter, drop the UUID gate, drop each of the four "should I even
      ask" gates, report a lookup failure as a missing notification, leave
      the screen's gate unwired, hard-code its failure flag, break the cache
      patcher on the new single-page shape, and read "settled" where
      "errored" is meant.

Run: python3 scripts/falsify-iter265-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
CORE = ROOT / "packages" / "core"

W = "app/(app)/[workspace]"

SCHEMAS = APP / "data" / "schemas.ts"
RUNS = APP / W / "issue" / "[id]" / "runs.tsx"
RUN_ROW = APP / "components" / "issue" / "run-row.tsx"
TIMELINE = APP / "components" / "issue" / "run-timeline-panel.tsx"
USAGE = APP / "components" / "issue" / "usage-breakdown-dialog.tsx"
RUN_TIMELINE_LIB = APP / "lib" / "issue-run-timeline.ts"

API = APP / "data" / "api.ts"
INBOX_QUERIES = APP / "data" / "queries" / "inbox.ts"
ARCHIVE_VIEW = APP / "lib" / "inbox-archive-view.ts"
ITEM_SOURCE = APP / "lib" / "inbox-item-source.ts"
ITEM_SCREEN = APP / W / "inbox-item" / "[id].tsx"

CORE_TYPES = CORE / "types" / "agent.ts"
CORE_ACTIVITY = CORE / "issues" / "surface" / "issue-activity.ts"

SUITE = [
    "lib/iter265-wiring.test.ts",
    "lib/inbox-archive-view.test.ts",
    "lib/inbox-item-source.test.ts",
    "lib/issue-run-timeline.test.ts",
    "data/schemas-agent-task-status.test.ts",
    "data/api-inbox-archive-page.test.ts",
    "data/queries/inbox-archive-pages.test.ts",
]

CORE_SUITE = ["issues/surface/issue-activity.test.ts"]


def run_mobile() -> tuple[bool, str]:
    proc = subprocess.run(
        ["../../node_modules/.bin/vitest", "run", *SUITE],
        cwd=APP, capture_output=True, text=True, timeout=900,
    )
    out = proc.stdout + proc.stderr
    tail = "\n".join(
        line for line in out.splitlines()
        if re.search(r"Tests\s+\d|Test Files\s+\d|error TS", line)
    )
    return proc.returncode == 0, tail


def run_core() -> tuple[bool, str]:
    proc = subprocess.run(
        ["../../node_modules/.bin/vitest", "run", *CORE_SUITE],
        cwd=CORE, capture_output=True, text=True, timeout=900,
    )
    out = proc.stdout + proc.stderr
    tail = "\n".join(
        line for line in out.splitlines()
        if re.search(r"Tests\s+\d|Test Files\s+\d|error TS", line)
    )
    return proc.returncode == 0, tail


def run_suite() -> tuple[bool, str]:
    mobile_green, mobile_tail = run_mobile()
    core_green, core_tail = run_core()
    return (
        mobile_green and core_green,
        f"mobile: {mobile_tail} | core: {core_tail}",
    )


MUTATIONS: list[tuple[str, Path, str, str]] = [
    # ── #1 deferred is a named status ──────────────────────────────────────
    (
        "1. the schema drops deferred back out of the enum, so a parked retry "
        "arrives as 'queued' and renders as active work — the fact bug this "
        "round exists to fix",
        SCHEMAS,
        # The needle is anchored on the enum member itself. Iteration 265
        # rewrote the comment above `"deferred"` while landing the change, so
        # the original needle (which quoted the pre-landing comment) stopped
        # matching — the mutation reported MISS instead of testing anything.
        # Matching `"deferred",` directly keeps the mutation aimed at the live
        # code and stays correct if the comment is edited again.
        '      "deferred",\n      "running",\n',
        '      "running",\n',
    ),
    (
        "2. core's AgentTask.status union loses deferred, so every downstream "
        "branch written for it becomes unreachable and the next tsc run rejects "
        "the maps that name it",
        CORE_TYPES,
        '    | "waiting_local_directory"\n    | "deferred"\n',
        '    | "waiting_local_directory"\n',
    ),
    (
        "3. the runs sheet's active list takes whatever the endpoint returns, so "
        "a server that widens its active query (the workspace snapshot did "
        "exactly that upstream) lists runs that never happened",
        RUNS,
        ".filter((task) => ACTIVE_TASK_STATUSES.has(task.status))",
        ".filter(() => true)",
    ),
    (
        "4. the runs sheet's Past section gains deferred, putting a retry that "
        "has not run yet into the history list",
        RUNS,
        '        t.status === "completed" ||\n'
        '        t.status === "failed" ||\n'
        '        t.status === "cancelled",',
        '        t.status === "completed" ||\n'
        '        t.status === "failed" ||\n'
        '        t.status === "deferred" ||\n'
        '        t.status === "cancelled",',
    ),
    (
        "5. the usage breakdown counts a deferred retry as a run — and it can "
        "carry usage inherited from the attempt it continues, so the total is "
        "charged to a run the user never got",
        USAGE,
        '() => tasks.filter((task) => task.status !== "deferred"),',
        "() => [...tasks],",
    ),
    (
        "6. the breakdown keeps the deferred filter but prices the raw task "
        "list, so the exclusion exists and is never consulted",
        USAGE,
        "() => counted.filter((task) => (task.usage?.length ?? 0) > 0),",
        "() => tasks.filter((task) => (task.usage?.length ?? 0) > 0),",
    ),
    (
        "7. the run timeline treats deferred as active, drawing a live bar "
        "stretching to now for a retry that has not started",
        RUN_TIMELINE_LIB,
        'const ACTIVE_STATUSES = new Set<AgentTask["status"]>([\n'
        '  "queued",\n'
        '  "dispatched",\n'
        '  "waiting_local_directory",\n'
        '  "running",\n'
        "]);",
        'const ACTIVE_STATUSES = new Set<AgentTask["status"]>([\n'
        '  "queued",\n'
        '  "dispatched",\n'
        '  "waiting_local_directory",\n'
        '  "deferred",\n'
        '  "running",\n'
        "]);",
    ),
    (
        "8. run-row's status map loses its deferred key, which is the shape "
        "that compiles today and silently returns undefined the moment core "
        "names the status — a row with no tone at all",
        RUN_ROW,
        '  deferred: "text-warning",\n  dispatched: "text-brand",',
        '  dispatched: "text-brand",',
    ),
    (
        "9. the activity predicate regains its wakeup condition nowhere — every "
        "deferred task counts as queued, so an orphaned parked retry keeps the "
        "'an agent is working' badge alive forever",
        CORE_ACTIVITY,
        '    (status === "deferred" && !!wakeupId)',
        '    (status === "deferred" && (!!wakeupId || true))',
    ),
    (
        "10. the predicate keeps the condition but its caller stops passing "
        "wakeup_id, so the conditional half is dead code and deferred NEVER "
        "counts — an issue whose retry a rule will fire reads as idle",
        CORE_ACTIVITY,
        "if (task.status === \"running\") running.push(task);\n"
        "    else if (isQueuedTaskStatus(task.status, task.wakeup_id)) queued.push(task);",
        "if (task.status === \"running\") running.push(task);\n"
        "    else if (isQueuedTaskStatus(task.status)) queued.push(task);",
    ),

    # ── #2 the archive deep link ───────────────────────────────────────────
    (
        "11. the lookup key hangs off the cursor chain instead of beside it, so "
        "a filter change resets the chain and takes the resolved row with it",
        INBOX_QUERIES,
        '    [...inboxKeys.archived(wsId), "lookup"] as const,',
        '    [...inboxKeys.pages(wsId), "lookup"] as const,',
    ),
    (
        "12. the request drops group_id, so the lookup becomes an ordinary page "
        "one — the same bounded read that could not find the row in the first "
        "place",
        API,
        '    if (options.groupId) params.set("group_id", options.groupId);',
        "    // group_id dropped",
    ),
    (
        "13. the enabled-gate stops checking the group is a UUID, so a slug or "
        "an empty id goes on the wire and the server answers 400 — a guaranteed "
        "failure the screen then renders as an unavailable notification",
        INBOX_QUERIES,
        "    enabled: !!wsId && isIssueUuid(groupId),",
        "    enabled: !!wsId,",
    ),
    (
        "14. the gate stops excluding a failed list read, so 'we could not "
        "read the archive' is resolved into 'this notification is gone'",
        ITEM_SOURCE,
        "    !input.failed &&\n    !input.lookupFailed &&",
        "    !input.lookupFailed &&",
    ),
    (
        "15. the gate stops excluding an already-found row, so a notification "
        "that IS in the list still costs a second request for itself",
        ITEM_SOURCE,
        "    !input.hasItem &&\n    !input.failed &&",
        "    !input.failed &&",
    ),
    (
        "16. the gate stops requiring a resolved workspace id, so the very "
        "first render (wsId still null) fires a lookup with no workspace "
        "header — a guaranteed 401 the screen reports as missing",
        ITEM_SOURCE,
        "    input.workspaceReady &&\n    !input.hasItem &&",
        "    !input.hasItem &&",
    ),
    (
        "17. the gate stops latching on its own failure, so a failing lookup "
        "is re-armed on every render and hammers the endpoint",
        ITEM_SOURCE,
        "    !input.lookupFailed &&\n    isIssueUuid(input.notificationId)",
        "    isIssueUuid(input.notificationId)",
    ),
    (
        "18. the screen's error branch stops seeing the lookup failure, so a "
        "lookup that could not reach the server renders as 「这条通知已不可用。」",
        ITEM_SCREEN,
        "    failed: primaryQuery.isError || fallbackQuery.isError || lookupQuery.isError,",
        "    failed: primaryQuery.isError || fallbackQuery.isError,",
    ),
    (
        "19. the notification-id gate stops checking the UUID, so a link with a "
        "slug spends a request the server answers with 400",
        ITEM_SOURCE,
        "    !input.lookupFailed &&\n    isIssueUuid(input.notificationId)",
        "    !input.lookupFailed",
    ),
    (
        "20. the item screen never calls the gate — the pure module is correct, "
        "fully tested, and unreferenced, which fixes nothing on a device",
        ITEM_SCREEN,
        "    enabled: shouldLookupArchivedItem({",
        "    enabled: ({\n"
        "      workspaceReady: !!wsId,\n"
        "      hasItem: !!activeItem,\n"
        "      failed: primaryQuery.isError || fallbackQuery.isError,\n"
        "      lookupFailed,\n"
        "      notificationId: id,\n"
        "    } as unknown as Parameters<typeof shouldLookupArchivedItem>[0]),",
    ),
    (
        "21. the screen hard-codes lookupFailed to false, so a failed lookup is "
        "re-armed on every render and hammers the endpoint it just failed on",
        ITEM_SCREEN,
        "      lookupFailed,\n      notificationId: id,",
        "      lookupFailed: false,\n      notificationId: id,",
    ),
    (
        "22. the cache patcher stops distinguishing the single-page shape, so "
        "the first archive/unarchive after a deep link throws inside "
        "`data.pages.map` — a crash caused by opening a notification",
        INBOX_QUERIES,
        '  if ("pages" in data) {\n'
        "    return {\n"
        "      ...data,\n"
        "      pages: data.pages.map((page) => ({ ...page, items: apply(page.items) })),\n"
        "    };\n"
        "  }\n"
        "  return { ...data, items: apply(data.items) };",
        "  return {\n"
        "    ...data,\n"
        '    pages: (data as { pages: ArchivedInboxPage[] }).pages.map((page) => ({\n'
        "      ...page,\n"
        "      items: apply(page.items),\n"
        "    })),\n"
        "  };",
    ),
    (
        "23. the subscription that feeds the gate reports 'settled' instead of "
        "'errored', so a lookup that SUCCEEDED disables itself and the next "
        "deep link to the same notification never resolves",
        ITEM_SCREEN,
        '    () => qc.getQueryState(queryKey)?.status === "error",',
        '    () => qc.getQueryState(queryKey)?.status !== "pending",',
    ),
]


def find(path: Path, needle: str) -> int:
    return path.read_text().count(needle)


_backups: dict[Path, str] = {}


def snapshot() -> None:
    for _, path, _, _ in MUTATIONS:
        _backups.setdefault(path, path.read_text())


def restore() -> None:
    for path, text in _backups.items():
        path.write_text(text)


def main() -> int:
    snapshot()

    print("=" * 78)
    print("baseline")
    green, tail = run_suite()
    print(("GREEN" if green else "RED") + "  " + tail.replace("\n", " | "))
    if not green:
        print("baseline is not green — refusing to run mutations")
        return 1

    failures: list[str] = []
    for index, (label, path, needle, replacement) in enumerate(MUTATIONS, start=1):
        occurrences = find(path, needle)
        if occurrences != 1:
            failures.append(
                f"[MISS] {label}: needle appears {occurrences}x in {path.name} "
                "(expected exactly 1 — the mutation no longer targets live code)"
            )
            print(f"[MISS] {index:>2}. {label}: needle x{occurrences}")
            continue
        restore()
        text = path.read_text()
        path.write_text(text.replace(needle, replacement, 1))
        green, tail = run_suite()
        restore()
        if green:
            failures.append(f"[BAD ] {label}: suite stayed GREEN — guard does not exist")
            print(f"[BAD ] {index:>2}. {label}: stayed GREEN")
        else:
            print(f"[OK]  {index:>2}. {label}: turned RED")

    print("=" * 78)
    restore()
    green, tail = run_suite()
    print("restore: " + ("GREEN" if green else "RED") + "  " + tail.replace("\n", " | "))
    if not green:
        failures.append("[BAD ] the suite did not return to GREEN after restore")

    if failures:
        print(f"\n{len(failures)} problem(s):")
        for line in failures:
            print("  " + line)
        return 1
    print(f"\nall {len(MUTATIONS)} mutations turned RED and restored GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
