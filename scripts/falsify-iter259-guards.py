#!/usr/bin/env python3
"""Mutation-test iteration 259's three fixes (MYS-2245).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, scripts/falsify-*.py).

The three gaps this round closes, and what the mutations attack:

  #1  Custom property values could not be set at create time. Web keeps them in
      local draft state and replays one PUT per property once the issue has an
      id. Mutations: put the values on the create payload (silently ignored by
      the server), read the draft AFTER resetDraft, skip the await so the write
      dies with the unmount, roll the create back on a property failure, abort
      at the first rejection, and assert "no properties" while the catalog is
      still unread.

  #2  A duplicate-title 409 surfaced as the raw server sentence. Mutations: drop
      the 409 guard, drop the schema guard, accept an empty jump target, build
      the path without a slug, and use push instead of replace.

  #3  The issue sidebar had no creator / created / updated block. Mutations:
      print the raw sentinel while the directory is unread, name the creator
      without checking readiness, hide the block behind the metadata section,
      and drop one of the three facts.

Run: python3 scripts/falsify-iter259-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"

SCREEN = APP / "app" / "(app)" / "[workspace]" / "new-issue.tsx"
PROP_EDITOR = APP / "app" / "(app)" / "[workspace]" / "new-issue-picker" / "property.tsx"
PROP_ROW = APP / "components" / "issue" / "create-form-property-row.tsx"
DETAILS = APP / "components" / "issue" / "issue-details-section.tsx"
TIMELINE = APP / "components" / "issue" / "timeline-list.tsx"
DUP = APP / "lib" / "duplicate-issue-error.ts"
PROMPTS = APP / "lib" / "create-failure-prompts.ts"
WRITES = APP / "lib" / "create-property-writes.ts"
FACTS = APP / "lib" / "issue-details-facts.ts"
STORE = APP / "data" / "stores" / "new-issue-draft-store.ts"

SUITE = [
    "lib/issue-details-facts.test.ts",
    "lib/duplicate-issue-error.test.ts",
    "lib/create-property-writes.test.ts",
    "lib/iter259-wiring.test.ts",
]


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        ["../../node_modules/.bin/vitest", "run", *SUITE],
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
    # ── #1 custom properties at create time ─────────────────────────────────
    (
        "1. property values ride the create payload — the server ignores the "
        "unknown field, so the 201 looks fine and the values are lost",
        SCREEN,
        '        title: trimmedTitle,\n        description: finalDescription || undefined,',
        '        title: trimmedTitle,\n        propertyValues,\n        description: finalDescription || undefined,',
    ),
    (
        "2. the fan-out consumes the LIVE store instead of the pre-create "
        "snapshot, so it sends an empty map once resetDraft runs",
        SCREEN,
        "        pendingPropertyValues,\n      );",
        "        propertyValues,\n      );",
    ),
    (
        "3. the fan-out is not awaited, so `router.back()` unmounts the screen "
        "mid-write and the rejection is unobserved",
        SCREEN,
        "      const outcome = await writeCreatePropertyValues(",
        "      const outcome = writeCreatePropertyValues(",
    ),
    (
        "4. a property failure is reported as a FAILED CREATE, sending the user "
        "back to a form that would produce a duplicate",
        SCREEN,
        '        if (message) Alert.alert(t("newIssue.propertiesPartialTitle"), message);',
        '        if (message) { Alert.alert(t("newIssue.failedTitle"), message); return; }',
    ),
    (
        "5. the fan-out aborts at the first rejection, silently dropping the "
        "values queued behind it",
        WRITES,
        "  const results = await Promise.allSettled(",
        "  const results = await Promise.all(",
    ),
    (
        "6. falsy values are filtered out as if they were absent, so a checkbox "
        "\"No\" or a numeric 0 can never be set",
        WRITES,
        "  const entries = Object.entries(values ?? {});",
        "  const entries = Object.entries(values ?? {}).filter(([, v]) => Boolean(v));",
    ),
    (
        "7. a missing issue id is trusted, so the PUT goes to "
        "/api/issues//properties/x",
        WRITES,
        "  if (entries.length === 0 || !issueId) {",
        "  if (entries.length === 0) {",
    ),
    (
        "8. every failure is reported, so one create raises N alerts",
        WRITES,
        "    if (firstError === undefined) firstError = result.reason;",
        "    firstError = result.reason;",
    ),
    (
        "9. a message is raised even when nothing failed (\"0 properties "
        "failed\")",
        WRITES,
        "  if (outcome.failed.length === 0) return null;",
        "  if (outcome.failed.length < 0) return null;",
    ),
    (
        "10. the property row claims an empty workspace while the catalog is "
        "still unread — the MYS-1892 defect, re-committed",
        PROP_ROW,
        "  if (!catalog.isResolved) {",
        "  if (false) {",
    ),
    (
        "11. a failed catalog read gets no retry, so the row is a dead end",
        PROP_ROW,
        '    if (catalog.state === "error") {',
        '    if (false) {',
    ),
    (
        "12. the draft editor writes through the ISSUE mutation, which needs an "
        "issue id the create form does not have",
        PROP_EDITOR,
        "    setPropertyValue(propertyId, next);",
        "    void next;",
    ),
    (
        "13. a single-value commit does not close the sheet, so the user is "
        "stranded on a finished edit",
        PROP_EDITOR,
        "    if (!multi) close();",
        "    void multi;",
    ),
    (
        "14. the draft store drops property values on reset, so reopening the "
        "form loses them",
        STORE,
        "  propertyValues: {},",
        "  propertyValues: undefined as never,",
    ),
    (
        "15. persisted property values are trusted as-is, so a corrupt file "
        "reaches the value editors",
        STORE,
        "    propertyValues: asPropertyValues(d.propertyValues),",
        "    propertyValues: (d.propertyValues as never) ?? {},",
    ),
    (
        "16. a property value stops counting as draft content, so the sidebar's "
        "draft dot never lights for a properties-only draft",
        STORE,
        "      Object.keys(values.propertyValues).length > 0,",
        "      false,",
    ),
    (
        "16b. the shared body stops reporting typed text, so both headers commit "
        "the value the field held on OPEN and silently drop the edit",
        APP / "components" / "issue" / "pickers" / "property-value-body.tsx",
        "    onDraftChange?.(next);",
        "    void onDraftChange;",
    ),
    # ── #2 duplicate 409 ───────────────────────────────────────────────────
    (
        "17. the status guard is dropped, so any error carrying the body opens a "
        "duplicate prompt",
        DUP,
        "  if (!error || error.status !== 409) return { kind: \"other\" };",
        "  if (!error) return { kind: \"other\" };",
    ),
    (
        "18. the schema guard is dropped and the body is cast — a renamed server "
        "code renders a broken duplicate prompt",
        DUP,
        "  const parsed = DuplicateIssueErrorBodySchema.safeParse(error.body);\n  if (!parsed.success) return { kind: \"other\" };",
        "  const parsed = { success: true as const, data: error.body as DuplicateIssueErrorBody };",
    ),
    (
        "19. an EMPTY jump target is accepted, so \"View issue\" navigates to "
        "/ws/issue/",
        DUP,
        "  if (!parsed.data.issue.id) return { kind: \"other\" };",
        "  // no id check",
    ),
    (
        "20. the detail path is built without a slug, producing /undefined/issue/x",
        DUP,
        "  if (!wsSlug) return null;",
        "  // no slug guard",
    ),
    (
        "21. the prompt keeps its View button when there is no slug, so the "
        "button cannot navigate",
        PROMPTS,
        "  if (!path) {",
        "  if (false) {",
    ),
    (
        "22. the prompt navigates with push, stacking the detail ON the create "
        "modal",
        SCREEN,
        "          navigate: (path) => router.replace(path),",
        "          navigate: (path) => router.push(path),",
    ),
    (
        "23. the duplicate branch clears the draft, throwing away the user's "
        "work on a refusal that did not create anything",
        SCREEN,
        "      if (failure.kind === \"duplicate\") {",
        "      if (failure.kind === \"duplicate\") {\n        resetDraft();",
    ),
    # ── #3 issue Details block ─────────────────────────────────────────────
    (
        "24. readiness is not threaded through, so the creator name is asserted "
        "even while the directory is unread — the 254–257 defect, re-committed",
        FACTS,
        "    readiness: deps.readiness,",
        "    readiness: { member: true, agent: true, squad: true },",
    ),
    (
        "25. the unsettled creator renders a load mark as an empty string, which "
        "reads as \"no creator\"",
        DETAILS,
        '          {creator.kind === "name" ? (',
        '          {creator.kind !== "unsettled" ? (',
    ),
    (
        "26. the Details block is placed BELOW the metadata bag, inverting web's "
        "ordering",
        TIMELINE,
        "      <IssueDetailsSection issue={issue} />\n",
        "",
    ),
    (
        "27. the Updated row is dropped, so the block reports only two of the "
        "three facts",
        DETAILS,
        '        <DetailRow label={t("issue.details.updated")}>',
        '        <DetailRow label={t("issue.details.created")}>',
    ),
    (
        "28. the creator row stops rendering the avatar, so the block names "
        "nobody while the directory is unread",
        DETAILS,
        "          <ActorAvatar",
        "          <View",
    ),
]


def find(path: Path, needle: str) -> int:
    text = path.read_text()
    return text.count(needle)


def main() -> int:
    original: dict[Path, str] = {}
    touched = {m[1] for m in MUTATIONS}
    for path in touched:
        original[path] = path.read_text()

    def restore():
        for path, text in original.items():
            path.write_text(text)

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
            continue
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
    green, tail = run_suite()
    print("restore: " + ("GREEN" if green else "RED") + "  " + tail.replace("\n", " | "))
    if not green:
        failures.append("[BAD ] the suite did not return to GREEN after restore")
        restore()
        green2, _ = run_suite()
        if green2:
            print("re-restore: GREEN")

    if failures:
        print(f"\n{len(failures)} problem(s):")
        for line in failures:
            print("  " + line)
        return 1
    print(f"\nall {len(MUTATIONS)} mutations turned RED and restored GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
