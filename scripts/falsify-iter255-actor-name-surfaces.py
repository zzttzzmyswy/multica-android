#!/usr/bin/env python3
"""Mutation-test iteration 255's "the read-state rule reaches the four surface
families" change (MYS-2219).

Iteration 254 built the primitive (`lib/actor-name-state.ts` +
`components/ui/actor-name.tsx`) and wired it to six cells. This round wires it
to the surfaces where a name is not a cell but part of a LINE — the activity
timeline, the comment cards, the run records, the inbox — and that move is what
makes the change mutatable in ways the cell work was not:

  - the row painting a skeleton while the SEARCH INDEX still holds the fallback
    word, so in-page find reports 「Unknown」 for text nobody can see;
  - the index instead dropping the row entirely, so a find hit has no target to
    scroll to and the "next" button looks dead;
  - a folded thread's author list gaining the empty segment ("Ada, , Grace")
    the inline `join` produced, or an `+N` that counts a name nobody read;
  - a name embedded mid-sentence (the inbox line, the resolved-by row, the
    fold chevron's aria label) getting a load mark wedged into it, or the
    template's preposition left dangling in front of nothing;
  - a run record gated on the MEMBER directory, which is the exact regression
    the per-type readiness flag exists to prevent — and which looks fine on a
    warm cache, because both directories are usually resolved by then;
  - a `system` row losing its author name, because `system` is not one of the
    three directories and readiness can therefore never answer for it.

That last one is why this round added `SYSTEM_ACTOR_NAME`: wiring ANY surface
to the primitive without it silently blanks every platform notice, and no test
in iteration 254 would have noticed, because no wired surface drew one.

Each mutation injects exactly ONE such half-defect and asserts the suite turns
RED; the restore is then asserted GREEN. A guard that cannot be made to fail is
not a guard (the repo's standing discipline, `scripts/falsify-*.py`).

Run: python3 scripts/falsify-iter255-actor-name-surfaces.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
DECISIONS = APP / "lib" / "actor-name-state.ts"
LOOKUP = APP / "data" / "use-actor-name.ts"
SEARCH = APP / "lib" / "activity-search.ts"
ACTIVITY = APP / "components" / "issue" / "activity-row.tsx"
ISSUE_SCREEN = APP / "app" / "(app)" / "[workspace]" / "issue" / "[id].tsx"
CARD = APP / "components" / "issue" / "comment-card.tsx"
RUN_ROW = APP / "components" / "issue" / "run-row.tsx"
TIMELINE = APP / "components" / "issue" / "run-timeline-panel.tsx"
USAGE = APP / "components" / "issue" / "usage-breakdown-dialog.tsx"
INBOX = APP / "components" / "inbox" / "detail-label.tsx"
TABLE = APP / "components" / "issue" / "table-view.tsx"
CHIP = APP / "components" / "issue" / "attribute-chip.tsx"
ATTR_ROW = APP / "components" / "issue" / "attribute-row.tsx"
CREATE_ROW = APP / "components" / "issue" / "create-form-attribute-row.tsx"
PROPERTY_ROW = APP / "components" / "issue" / "custom-property-row.tsx"

SUITE = [
    "lib/actor-name-state.test.ts",
    "lib/actor-name-wiring.test.ts",
    "lib/actor-name-surfaces-wiring.test.ts",
    "lib/activity-search.test.ts",
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
    # ── the shared decision: the two shapes this round added ────────────────
    (
        "1. a system row is left to the directories (every platform notice is "
        "blanked)",
        LOOKUP,
        '      if (type === "system") return SYSTEM_ACTOR_STATE;\n',
        "",
    ),
    (
        "2. the system constant answers with the product name un-named "
        "(renders an empty string)",
        DECISIONS,
        'export const SYSTEM_ACTOR_STATE: ActorNameState = {\n'
        '  kind: "name",\n'
        "  name: SYSTEM_ACTOR_NAME,\n"
        "};",
        'export const SYSTEM_ACTOR_STATE: ActorNameState = {\n'
        '  kind: "name",\n'
        '  name: "",\n'
        "};",
    ),
    (
        "3. the author line's +N counts authors it never named (the inflation)",
        DECISIONS,
        '    if (state.kind === "unsettled") continue;\n'
        "    const text = actorNameText(state);\n"
        "    if (named.length < maxNamed) named.push(text);\n"
        "    else abbreviated += 1;",
        "    const text = actorNameText(state);\n"
        "    if (named.length < maxNamed && text) named.push(text);\n"
        "    else abbreviated += 1;",
    ),
    (
        "4. the author line's empty case falls through to the raw join (a bare "
        "separator with no name)",
        DECISIONS,
        '  if (head.length === 0) return "";',
        '  if (head.length === 0) return ", ";',
    ),
    (
        "5. a gone author is dropped instead of identified by its id fragment",
        DECISIONS,
        '    if (state.kind === "unsettled") continue;',
        '    if (state.kind !== "name") continue;',
    ),
    # ── the activity timeline: render and index must move together ──────────
    (
        "6. the row keeps the old getName wrapper (asserts a name it did not "
        "read)",
        ACTIVITY,
        "  const { resolveActorName } = useActorLookup();",
        '  const { getName } = useActorLookup();\n'
        '  const resolveActorName = (type: string | null | undefined, id: string | null | undefined) =>\n'
        '    ({ kind: "name" as const, name: getName(type as "member", id) });',
    ),
    (
        "7. the row's name run goes blank instead of painting a load state",
        ACTIVITY,
        "            ) : (\n"
        "              <Skeleton\n"
        '                className="h-3 w-14"\n'
        "                accessibilityElementsHidden\n"
        '                importantForAccessibility="no-hide-descendants"\n'
        "              />\n"
        "            )}",
        "            ) : null}",
    ),
    (
        "8. the search index takes a string resolver again (drifts from the "
        "render)",
        SEARCH,
        "  actor: actorNameText(deps.resolveActorName(entry.actor_type, entry.actor_id)),",
        "  actor: actorNameText(deps.resolveActorName(entry.actor_type, entry.actor_id)) || \"Unknown\",",
    ),
    (
        "9. the index keeps the unsettled row's actor run instead of dropping it",
        SEARCH,
        "      [actor, verb].filter((text) => text.length > 0),",
        "      [actor || \"Unknown\", verb],",
    ),
    (
        "10. the sentence fallback stops naming an actor it could not read "
        "(leaves a hole: 'assigned to ')",
        SEARCH,
        '  return actorNameText(resolve(type, id)) || (id ?? "");',
        "  return actorNameText(resolve(type, id));",
    ),
    (
        "11. the issue screen's index goes back to a getName-based resolver",
        ISSUE_SCREEN,
        "  const { resolveActorName } = useActorLookup();\n  const statusLabel = useStatusLabel(wsId);",
        '  const { getName } = useActorLookup();\n'
        '  const resolveActorName = (type: string | null | undefined, id: string | null | undefined) =>\n'
        '    ({ kind: "name" as const, name: getName(type, id) });\n'
        "  const statusLabel = useStatusLabel(wsId);",
    ),
    # ── the comment card ────────────────────────────────────────────────────
    (
        "12. the comment header names the author from the raw lookup",
        CARD,
        "  const name = actorNameText(\n"
        "    resolveActorName(\n"
        '      entry.actor_type as "member" | "agent" | null | undefined,\n'
        "      entry.actor_id,\n"
        "    ),\n"
        "  );",
        "  const name = actorNameText(resolveActorName(entry.actor_type, entry.actor_id)) || \"Unknown\";",
    ),
    (
        "13. the resolved-by row names a resolver it has not read",
        CARD,
        "  const resolverName = actorNameText(\n"
        "    resolveActorName(",
        '  const resolverName = "Unknown" || actorNameText(\n'
        "    resolveActorName(",
    ),
    (
        "14. the fold bars go back to an inline join (empty segments return)",
        CARD,
        "    return joinedActorNames(authors, resolveActorName, MAX_NAMED_AUTHORS);\n"
        "  }, [entry, replies, resolveActorName]);",
        "    return authors\n"
        '      .map((a) => actorNameText(resolveActorName(a.type, a.id)))\n'
        '      .join(", ");\n'
        "  }, [entry, replies, resolveActorName]);",
    ),
    (
        "15. the resolved bar keeps a 'by' clause with no author after it",
        CARD,
        'authorsLabel ? "comment.resolvedBar" : "comment.resolvedBarNoAuthors"',
        '"comment.resolvedBar"',
    ),
    (
        "16. the fold bar keeps a 'by' clause with no author after it",
        CARD,
        'authorsLabel ? "comment.foldBar" : "comment.foldBarNoAuthors"',
        '"comment.foldBar"',
    ),
    (
        "17. the fold chevron's aria label renders \"Collapse 's comment\"",
        CARD,
        "              name\n"
        '                ? t(isFolded ? "comment.expandAria" : "comment.collapseAria", {\n'
        "                    name,\n"
        "                  })\n"
        "                : t(\n"
        "                    isFolded\n"
        '                      ? "comment.expandAriaNoName"\n'
        '                      : "comment.collapseAriaNoName",\n'
        "                  )",
        '              t(isFolded ? "comment.expandAria" : "comment.collapseAria", {\n'
        "                name,\n"
        "              })",
    ),
    # ── the run records: agent-only readiness ───────────────────────────────
    (
        "18. a run row waits on the member directory too (blanks agents when "
        "members are slow)",
        RUN_ROW,
        "  const { resolveActorName } = useActorLookup();",
        '  const { resolveActorName: resolveAny, resolvedBy } = useActorLookup();\n'
        "  const resolveActorName = (type: string | null | undefined, id: string | null | undefined) =>\n"
        "    resolvedBy.member && resolvedBy.agent\n"
        "      ? resolveAny(type, id)\n"
        "      : ({ kind: \"unsettled\" } as const);",
    ),
    (
        "19. the run row's name and its separator split apart (draws ' · task')",
        RUN_ROW,
        "          {agentName ? (\n"
        "            <>\n"
        '              <Text className="font-medium">{agentName}</Text>\n'
        '              <Text className="text-muted-foreground"> · {summary}</Text>\n'
        "            </>\n"
        "          ) : (\n"
        '            <Text className="text-muted-foreground">{summary}</Text>\n'
        "          )}",
        '          <Text className="font-medium">{agentName}</Text>\n'
        '          <Text className="text-muted-foreground"> · {summary}</Text>',
    ),
    (
        "20. the readout joins a leading separator before the timestamp",
        TIMELINE,
        "            .filter((part) => part.length > 0)\n",
        "",
    ),
    (
        "21. the readout goes back to the raw lookup",
        TIMELINE,
        "          {[actorNameText(resolveActorName(\"agent\", run.task.agent_id)), ...facts]",
        '          {[getName("agent", run.task.agent_id), ...facts]',
    ),
    (
        "22. the chart lane label goes back to the raw lookup",
        TIMELINE,
        '                  {actorNameText(resolveActorName("agent", lane.agentId))}',
        '                  {getName("agent", lane.agentId)}',
    ),
    (
        "23. the run list row goes back to a name it has not read",
        TIMELINE,
        '            {actorNameText(resolveActorName("agent", task.agent_id))}',
        '            {actorNameText(resolveActorName("agent", task.agent_id)) || "Unknown Agent"}',
    ),
    (
        "24. the cost bar's label column loses its fixed width (the bar "
        "reflows when the name lands)",
        USAGE,
        '          <View className="w-24">\n',
        "          <View>\n",
    ),
    (
        "25. the cost bar's row label renders a name it has not read",
        USAGE,
        '              state={resolveActorName("agent", row.agentId)}',
        '              state={{ kind: "name", name: "Unknown Agent" }}',
    ),
    (
        "26. the usage card's name and separator split apart (draws ' · trigger')",
        USAGE,
        "          {agentName ? (\n"
        "            <>\n"
        '              <Text className="font-medium">{agentName}</Text>\n'
        "              {trigger ? <Text> · {trigger}</Text> : null}\n"
        "            </>\n"
        "          ) : (\n"
        "            <Text>{trigger}</Text>\n"
        "          )}",
        '          <Text className="font-medium">{agentName}</Text>\n'
        "          {trigger ? <Text> · {trigger}</Text> : null}",
    ),
    # ── the inbox line: a name inside a sentence ────────────────────────────
    (
        "27. the inbox line drops an unread name into 'Assigned to {{name}}'",
        INBOX,
        '        return name ? t("inbox.assignedTo", { name }) : typeLabel(t, item.type);',
        '        return t("inbox.assignedTo", { name });',
    ),
    (
        "28. the inbox line names an assignee it could not look up",
        INBOX,
        "        const name = actorNameText(\n",
        "        const name = \"Unknown\" || actorNameText(\n",
    ),
    # ── the table's group band ──────────────────────────────────────────────
    (
        "29. the assignee group band names an unresolved actor",
        TABLE,
        "        return (\n"
        "          actorNameText(resolveActorName(value.actor.type, value.actor.id)) ||\n"
        '          t("issues.boardReadingAssignee")\n'
        "        );",
        "        return (\n"
        '          actorNameText(resolveActorName(value.actor.type, value.actor.id)) ||\n'
        '          "Unknown"\n'
        "        );",
    ),
    (
        "30. the group KEY goes through the withholding resolver too (merges "
        "every unresolved assignee into one bucket)",
        TABLE,
        "  const groupActorName = useCallback(\n"
        "    (actor: IssueTableGroupActor) => getName(actor.type, actor.id),",
        "  const groupActorName = useCallback(\n"
        "    (actor: IssueTableGroupActor) =>\n"
        "      actorNameText(resolveActorName(actor.type, actor.id)),",
    ),
    # ── the issue-detail chips (found on the device, not in review) ─────────
    (
        "31. the attribute chip can no longer withhold its label",
        CHIP,
        "  label: string | null;",
        "  label: string;",
    ),
    (
        "32. the attribute chip draws a blank instead of a load mark",
        CHIP,
        "      {label === null ? (",
        "      {label === null ? null : (",
    ),
    (
        "33. the assignee chip says attr.unknown instead of withholding",
        ATTR_ROW,
        "          label={assigneeName}",
        '          label={assigneeName ?? t("attr.unknown")}',
    ),
    (
        "34. the assignee chip names an actor it has not read",
        ATTR_ROW,
        "    ? actorNameText(resolveActorName(assigneeValue.type, assigneeValue.id)) ||\n"
        "      null",
        "    ? actorNameText(resolveActorName(assigneeValue.type, assigneeValue.id)) ||\n"
        '      "Unknown Agent"',
    ),
    (
        "35. the new-issue draft chip falls back to a name it has not read",
        CREATE_ROW,
        "    ? actorNameText(resolveActorName(assignee.type, assignee.id)) || null",
        '    ? actorNameText(resolveActorName(assignee.type, assignee.id)) || "Unknown"',
    ),
    (
        "36. an actor property's chip joins with empty segments again",
        PROPERTY_ROW,
        "                    .filter(Boolean)\n",
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
        if old == new:
            print(f"[SKIP] {name}: mutation is a no-op")
            failures.append(name)
            continue
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
