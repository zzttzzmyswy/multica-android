#!/usr/bin/env python3
"""Mutation-test iteration 241's guard.

Each mutation injects ONE defect into the export walk and asserts that the
suite turns RED on it; the restore is asserted GREEN. A guard that cannot be
made to fail is not a guard — this is the repo's standing discipline
(`scripts/falsify-iter*.py`).

The mutations are the ones the acceptance criteria name, plus the ones the new
code's own invariants depend on:

  1. `query_fingerprint` changes between pages  -> still accepted (guard: acceptExportPage)
  2. a row id repeats across pages              -> still accepted (guard: acceptExportPage)
  3. rows.length != first page's total          -> still accepted (guard: collectIssueTableExportRows)
  4. page.limit raised to 200 (server 400s)     -> the constant's boundary pin
  5. the cursor loop guard removed              -> an infinite walk
  6. `group_key` / `parent_id` drift accepted   -> the flat-set assertion
  7. the first-page `total` read replaced by the LAST page's (the measured
     0-on-later-pages trap)
  8. the row ceiling dropped                    -> an unbounded phone-side walk
  9. the export falls back to the loaded window -> the wiring guard

Run: python3 scripts/falsify-iter241-export-server.py
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
LIB = APP / "lib" / "issue-table-export-server.ts"
VIEW = APP / "components" / "issue" / "table-view.tsx"
API_TEST = APP / "data" / "api-issue-table-rows.test.ts"

SUITE = [
    "lib/issue-table-export-server.test.ts",
    "lib/table-export-wiring.test.ts",
    "data/api-issue-table-rows.test.ts",
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
        "1. cross-page query_fingerprint change is tolerated",
        LIB,
        """  if (
    expectedFingerprint !== null &&
    page.query_fingerprint !== expectedFingerprint
  ) {
    throw new IssueTableExportIntegrityError("fingerprint_changed");
  }""",
        """  if (false) {
    throw new IssueTableExportIntegrityError("fingerprint_changed");
  }""",
    ),
    (
        "2. a duplicated issue id is tolerated",
        LIB,
        """    if (seenIssueIds.has(row.issue.id)) {
      throw new IssueTableExportIntegrityError("duplicate_row");
    }""",
        """    if (false) {
      throw new IssueTableExportIntegrityError("duplicate_row");
    }""",
    ),
    (
        "3. a short result set (rows.length != first-page total) is tolerated",
        LIB,
        """  if (expectedTotal === null || rows.length !== expectedTotal) {
    throw new IssueTableExportIntegrityError("row_count_mismatch");
  }""",
        """  if (expectedTotal === null) {
    throw new IssueTableExportIntegrityError("row_count_mismatch");
  }""",
    ),
    (
        "4. the page limit is raised past the server's accepted maximum",
        LIB,
        "export const ISSUE_TABLE_EXPORT_PAGE_LIMIT = 100;",
        "export const ISSUE_TABLE_EXPORT_PAGE_LIMIT = 200;",
    ),
    (
        "5. the cursor-repetition guard is removed (walk can spin forever)",
        LIB,
        """      if (seenCursors.has(cursor)) {
        throw new IssueTableExportIntegrityError("cursor_loop");
      }
      seenCursors.add(cursor);""",
        """      seenCursors.add(cursor);""",
    ),
    (
        "6. group_key / parent_id drift is accepted (a grouped page is used)",
        LIB,
        """  if (page.group_key !== null || page.parent_id !== null) {
    throw new IssueTableExportIntegrityError("scope_drift");
  }""",
        """  if (false && page.group_key !== null && page.parent_id !== null) {
    throw new IssueTableExportIntegrityError("scope_drift");
  }""",
    ),
    (
        "7. the empty-fingerprint sentinel check is removed (drift reads as a page)",
        LIB,
        """  if (!page.query_fingerprint) {
    throw new IssueTableExportIntegrityError("fingerprint_missing");
  }""",
        """  if (page.query_fingerprint === "__never__") {
    throw new IssueTableExportIntegrityError("fingerprint_missing");
  }""",
    ),
    (
        "8. the phone-side row ceiling is dropped",
        LIB,
        "const maxRows = options.maxRows ?? ISSUE_TABLE_EXPORT_MAX_ROWS;",
        "const maxRows = options.maxRows ?? Number.MAX_SAFE_INTEGER;",
    ),
    (
        "9. a surface stops passing the export query down",
        APP / "app" / "(app)" / "[workspace]" / "more" / "issues.tsx",
        "          exportQuery={groupCountQuery}\n",
        "",
    ),
    (
        "10. the component goes back to serializing its loaded window",
        VIEW,
        """          const rows =
            scope === "all"
              ? (await collectExportRows()).rows
              : selectedIssues;""",
        """          const rows = scope === "all" ? issues : selectedIssues;""",
    ),
    (
        "11. the quick search is dropped from the export query",
        LIB,
        "    ...(search ? { search } : {}),",
        "",
    ),
    (
        "12. the table's live sort is replaced by the count projection's pinned one",
        LIB,
        "    sort: { field: sort.field, direction: sort.direction },",
        '    sort: { field: "position", direction: "asc" },',
    ),
    (
        "13. the rows method POSTs the groups endpoint (transport swapped)",
        APP / "data" / "api.ts",
        '''      "/api/issues/table/rows",
      IssueTableRowsResponseSchema,''',
        '''      "/api/issues/table/groups",
      IssueTableRowsResponseSchema,''',
    ),
]


def main() -> int:
    print("== baseline ==")
    green, tail = run_suite()
    print(tail)
    if not green:
        print("!! baseline is RED — fix that before mutating")
        return 2

    results = []
    for name, path, old, new in MUTATIONS:
        src = path.read_text(encoding="utf-8")
        if old not in src:
            print(f"MISS  {name}\n      anchor not found in {path.name}")
            results.append((name, "MISS"))
            continue
        if src.count(old) != 1:
            print(f"MISS  {name}\n      anchor is not unique ({src.count(old)}x)")
            results.append((name, "MISS"))
            continue
        path.write_text(src.replace(old, new, 1), encoding="utf-8")
        try:
            green_after, tail_after = run_suite()
        finally:
            path.write_text(src, encoding="utf-8")
        verdict = "KILLED" if not green_after else "SURVIVED"
        print(f"{verdict}  {name}")
        if verdict == "SURVIVED":
            print(f"        {tail_after}")
        results.append((name, verdict))

    print("\n== restore ==")
    green, tail = run_suite()
    print(tail)
    restored = green

    killed = sum(1 for _, v in results if v == "KILLED")
    missed = [n for n, v in results if v == "MISS"]
    survived = [n for n, v in results if v == "SURVIVED"]
    print(f"\n{len(results)} mutations: {killed} killed, {len(survived)} survived, {len(missed)} miss")
    for n in survived:
        print("  SURVIVED:", n)
    for n in missed:
        print("  MISS:", n)
    print("restored green:", restored)
    return 0 if (not survived and not missed and restored) else 1


if __name__ == "__main__":
    sys.exit(main())
