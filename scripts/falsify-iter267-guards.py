#!/usr/bin/env python3
"""Mutation-test iteration 267's two parity fixes (MYS-2310).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, `scripts/falsify-*.py`).

The two gaps this round closes, and what the mutations attack:

  #1  "Create another" lost most of what web keeps across a batch (MUL-7648).
      Web retains the assignee, the just-submitted status, the parent and the
      stage; mobile reset the status to `todo` and dropped the parent + stage.
      Keeping the status is the easy half — the hard half is that an untouched
      continuation then looks exactly like a draft the user is working on, so
      the failure modes are all about telling those two apart:
        - the status goes back to `todo` (the pre-fix behaviour, exactly);
        - the baseline is never recorded, so every batch leaves a phantom dot;
        - the draft dot keeps using raw content, which the inherited status and
          assignee satisfy on their own;
        - the recoverable-intent rule forgets to consult the baseline, so a
          continuation whose only edit is the inherited field reads untouched;
        - the untouched continuation is persisted at its inherited status, so a
          reload presents it as a choice the user made;
        - the reset writes before installing its own baseline, which is the
          ordering bug that produces exactly that;
        - the form never ends the continuation, so the next FRESH dialog
          inherits the batch's status;
        - the batch clears the parent again (a sub-task batch re-asks);
        - the batch clears the stage again (a parent with no stage);
        - the reset shape grows a `status` field, a second silently-winning
          source for a value the store inherits;
        - the object comparison is by identity, so an untouched continuation
          reads as edited on every write (the store rebuilds these objects).

  #2  High and Medium priority drew the same yellow (upstream MUL-8155). Web
      split High onto `--priority-high` (orange); mobile's two hex maps kept
      `#eab308` for both, so the only difference between an urgent-ish row and
      a normal one was one filled bar. The failure modes:
        - High stays warning yellow on the issue icon;
        - the project icon is left behind, so a project row and an issue row
          with the same priority disagree;
        - Medium is swept into the orange too, which merely swaps the two;
        - an unrelated warning surface (status `in_progress`) is repainted.

Run: python3 scripts/falsify-iter267-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"

W = "app/(app)/[workspace]"

SCREEN = APP / W / "new-issue.tsx"
HEADER = APP / "components" / "ui" / "app-header-actions.tsx"
STORE = APP / "data" / "stores" / "new-issue-draft-store.ts"
BATCH = APP / "lib" / "new-issue-batch-continuation.ts"
KEEP_OPEN = APP / "lib" / "new-issue-keep-open.ts"
ISSUE_ICON = APP / "components" / "ui" / "priority-icon.tsx"
PROJECT_ICON = APP / "components" / "ui" / "project-priority-icon.tsx"

SUITE = [
    "lib/new-issue-batch-continuation.test.ts",
    "lib/new-issue-keep-open.test.ts",
    "lib/priority-color-parity.test.ts",
    "lib/iter267-wiring.test.ts",
    "lib/iter262-wiring.test.ts",
    "data/stores/new-issue-draft-store.test.ts",
]


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
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


MUTATIONS: list[tuple[str, Path, str, str]] = [
    # ── #1 a batch keeps status, parent and stage ──────────────────────────
    (
        "1. the status goes back to todo on the next issue of the batch — the "
        "pre-fix behaviour, exactly",
        STORE,
        "      const { assignee, status } = get();\n"
        "      const next: NewIssueDraftValues = {\n"
        "        ...EMPTY_NEW_ISSUE_DRAFT,\n"
        "        assignee,\n"
        "        status,\n"
        "      };\n",
        "      const { assignee } = get();\n"
        "      const next: NewIssueDraftValues = {\n"
        "        ...EMPTY_NEW_ISSUE_DRAFT,\n"
        "        assignee,\n"
        "      };\n",
    ),
    (
        "2. the reset never records a baseline, so an untouched continuation "
        "is indistinguishable from a real draft and every batch leaves a "
        "phantom dot behind",
        STORE,
        "      set({ ...next, batchContinuationBaseline: next });\n",
        "      set({ ...next, batchContinuationBaseline: null });\n",
    ),
    (
        "3. the reset writes before installing its own baseline, so the write "
        "classifies the fresh continuation as edited and persists the "
        "inherited status",
        STORE,
        "      writeThrough(next, next);\n",
        "      writeThrough(next, null);\n",
    ),
    (
        "4. the entry-point dot keeps using raw content, which the inherited "
        "status and assignee satisfy on their own",
        HEADER,
        "  const hasDraft = useNewIssueDraftStore((s) => draftHasRecoverableIntent(s));",
        "  const hasDraft = useNewIssueDraftStore((s) => draftHasContent(s));",
    ),
    (
        "5. the recoverable-intent rule never consults the baseline, so a "
        "continuation whose only edit is one of the inherited fields reads as "
        "untouched and is discarded",
        STORE,
        "    draftHasContent(withoutInherited) || batchFormChanged(state, baseline)\n",
        "    draftHasContent(withoutInherited)\n",
    ),
    (
        "6. the rule stops normalizing the inherited assignee, so a "
        "continuation nobody touched still counts as content (the assignee "
        "alone satisfies it)",
        STORE,
        "    assignee: EMPTY_NEW_ISSUE_DRAFT.assignee,\n",
        "",
    ),
    (
        "7. an untouched continuation is persisted at its inherited status, so "
        "a reload presents it as a choice the user made",
        STORE,
        "          status: normalizedBatchStatus(\n"
        "            values,\n"
        "            baseline,\n"
        "            EMPTY_NEW_ISSUE_DRAFT.status,\n"
        "          ),\n",
        "",
    ),
    (
        "8. the form never ends the continuation, so the next FRESH dialog "
        "inherits the batch's status",
        SCREEN,
        "      useNewIssueDraftStore.getState().endBatchContinuation();\n",
        "",
    ),
    (
        "9. ending the continuation keeps the baseline, so the NEXT batch "
        "compares against the wrong draft",
        STORE,
        "        set({ ...next, batchContinuationBaseline: null });\n"
        "        return;\n",
        "        set({ ...next });\n"
        "        return;\n",
    ),
    (
        "10. the batch clears the parent again, so a batch of sub-issues "
        "re-asks for the parent on every issue",
        SCREEN,
        "    setUploadedAttachmentIds([]);\n",
        "    setParentCleared(true);\n    setUploadedAttachmentIds([]);\n",
    ),
    (
        "11. the batch clears the stage again, leaving a form pointed at a "
        "parent with no stage",
        SCREEN,
        "    setUploadedAttachmentIds([]);\n",
        "    useNewIssueStagePickStore.getState().reset();\n"
        "    setUploadedAttachmentIds([]);\n",
    ),
    (
        "12. the reset shape grows a status field — a second, silently-winning "
        "source for a value the store inherits from live state",
        KEEP_OPEN,
        "  priority: string;\n",
        "  status: string;\n  priority: string;\n",
    ),
    (
        "13. the object comparison is by identity, so an untouched "
        "continuation reads as edited on every write (the store rebuilds "
        "labels / project / assignee each time)",
        BATCH,
        "  if (Array.isArray(a) || Array.isArray(b)) {\n",
        "  if (a !== b) return false;\n  if (Array.isArray(a) || Array.isArray(b)) {\n",
    ),
    (
        "14. property-value key order is treated as a change, so a map the "
        "user did not touch keeps a continuation alive",
        BATCH,
        "    return aKeys.every(\n"
        "      (key) =>\n"
        "        Object.prototype.hasOwnProperty.call(bRecord, key) &&\n"
        "        fieldEqual(aRecord[key], bRecord[key]),\n"
        "    );\n",
        "    return aKeys.every((key, i) => key === bKeys[i]);\n",
    ),
    (
        "15. an untouched continuation is NOT normalized on close, so the next "
        "fresh dialog starts from the batch's status",
        BATCH,
        "  return hasInheritedStatus(current, baseline) ? defaultStatus : current.status;\n",
        "  void baseline;\n  return current.status;\n",
    ),
    # ── #2 High gets its own colour ───────────────────────────────────────
    (
        "16. High stays on warning yellow on the issue icon — the upstream "
        "split simply not applied",
        ISSUE_ICON,
        '  high: "#f97316", // priority-high\n',
        '  high: "#eab308", // warning\n',
    ),
    (
        "17. the project icon is left behind, so a project row and an issue "
        "row with the same priority disagree about its colour",
        PROJECT_ICON,
        '  high: "#f97316",\n',
        '  high: "#eab308",\n',
    ),
    (
        "18. Medium is swept into the orange too, which merely swaps the two "
        "and leaves them indistinguishable again",
        ISSUE_ICON,
        '  medium: "#eab308", // warning\n',
        '  medium: "#f97316", // warning\n',
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
