#!/usr/bin/env python3
"""Mutation-test iteration 256's "the read-state rule reaches identity property
values, and pickers get an echo rule of their own" change (MYS-2227).

Iterations 254 and 255 wired cells and lines. What was left were the two shapes
one rule could not serve:

  - a detail page's PROPERTY ROW ("Owner", "Installed by", "Leader",
    "Subscribers"), where the actor is the row's value and there is no cell
    machinery to hang a `state` on;
  - a picker's ECHO, where the string is not a claim about a directory at all —
    the user picked it one tap ago — and withholding it is the bug rather than
    the fix.

Each half has failure modes the other cannot have, which is what makes this
round mutatable in ways 254/255 were not:

  - a property row gated on the COMBINED readiness flag (`members && agents`),
    blanking an agent-only row whenever the member list is slow — invisible on a
    warm cache, which is where every manual check happens;
  - an unread value drawn as the row's own "—" empty mark, turning "we have not
    read this" into "there is no installer";
  - a picker that withholds, so the confirm dialog asks 「Assign this issue to .」
    or the field reads as unfilled right after being filled;
  - a picker that withholds the OTHER way — printing a sentinel — so the fix
    becomes the defect it replaced;
  - a filter chip whose ORDER follows its (withholdable) label, so chips
    reshuffle as directories answer and interleave on a partial cache;
  - a section header left blank, which reads as a rendering fault rather than as
    "not read yet";
  - an author line blanked while its search haystack still holds the fallback
    word, so in-page find matches text nobody can see;
  - the snapshot's frozen author name re-resolved against a live directory that
    may since have changed or lost the row.

Each mutation injects exactly ONE such half-defect and asserts the suite turns
RED; the restore is then asserted GREEN. A guard that cannot be made to fail is
not a guard (the repo's standing discipline, `scripts/falsify-*.py`).

Run: python3 scripts/falsify-iter256-actor-identity-props.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
DECISIONS = APP / "lib" / "actor-name-state.ts"
FILTERS = APP / "lib" / "filter-projects.ts"
AGENT_PAGE = APP / "app" / "(app)" / "[workspace]" / "more" / "agents" / "[id].tsx"
INTEGRATIONS = (
    APP / "app" / "(app)" / "[workspace]" / "more" / "agents" / "[id]" / "integrations.tsx"
)
AUTOPILOTS = (
    APP / "app" / "(app)" / "[workspace]" / "more" / "autopilots" / "[id].tsx"
)
SQUADS = APP / "app" / "(app)" / "[workspace]" / "more" / "squads.tsx"
TRANSCRIPT = APP / "components" / "agent" / "run-transcript-dialog.tsx"
ROSTER = APP / "components" / "issue" / "working-agents-roster.tsx"
PROJECT_PROPS = APP / "components" / "project" / "project-properties-section.tsx"
PROJECTS_SCREEN = APP / "components" / "project" / "projects-screen.tsx"
CHROME = APP / "components" / "issue" / "issue-surface-chrome.tsx"
THREAD_NAV = APP / "components" / "issue" / "thread-nav-sheet.tsx"
CONTEXT_MENU = APP / "components" / "issue" / "comment-context-menu.tsx"
DELIVERABLES = APP / "components" / "issue" / "deliverables-overview-sheet.tsx"
SOURCE_CONTEXT = APP / "components" / "issue" / "source-context-create-body.tsx"
PICKER_ASSIGNEE = (
    APP / "app" / "(app)" / "[workspace]" / "issue" / "[id]" / "picker" / "assignee.tsx"
)
BATCH_BAR = APP / "components" / "issue" / "batch-action-bar.tsx"
QUICK_CREATE = APP / "components" / "issue" / "quick-create-panel.tsx"
PROPERTY_EDITOR = APP / "components" / "issue" / "pickers" / "property-value-editor.tsx"

SUITE = [
    "lib/actor-name-state.test.ts",
    "lib/actor-name-wiring.test.ts",
    "lib/actor-name-surfaces-wiring.test.ts",
    "lib/actor-identity-wiring.test.ts",
    "lib/lead-filter-options.test.ts",
    "lib/actor-property-wiring.test.ts",
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
    # ── the echo decision: the shape this round added ───────────────────────
    (
        "1. an echo withholds like an assertion (the picker goes blank, the "
        "confirm dialog opens on a hole)",
        DECISIONS,
        "  if (state.kind !== \"unsettled\") return state.name;\n"
        "  return (\n"
        "    fallback || ECHO_FALLBACK_BY_TYPE[type as ActorType] || ECHO_UNKNOWN_NOUN\n"
        "  );",
        '  if (state.kind !== "unsettled") return state.name;\n'
        '  return "";',
    ),
    (
        "2. an echo answers with a sentinel instead (the fix becomes the "
        "defect it replaced)",
        DECISIONS,
        "    fallback || ECHO_FALLBACK_BY_TYPE[type as ActorType] || ECHO_UNKNOWN_NOUN",
        '    "Unknown"',
    ),
    (
        "3. an echo loses the settled-but-gone case (a selection pointing at a "
        "deleted agent stops identifying which one)",
        DECISIONS,
        '  if (state.kind !== "unsettled") return state.name;',
        '  if (state.kind === "name") return state.name;',
    ),
    (
        "4. an unset field borrows the type noun instead of keeping its own "
        "「Unassigned」 (a measured absence becomes a guess)",
        DECISIONS,
        "  if (input.empty) return input.emptyLabel;",
        "  if (input.empty) return selectedActorLabel(input);",
    ),
    (
        "5. an unknown actor type echoes as the literal word 'undefined'",
        DECISIONS,
        "    fallback || ECHO_FALLBACK_BY_TYPE[type as ActorType] || ECHO_UNKNOWN_NOUN",
        "    fallback || ECHO_FALLBACK_BY_TYPE[type as ActorType]",
    ),
    # ── property rows: per-type readiness, and never the empty mark ─────────
    (
        "6. the agent owner row waits on BOTH directories (a slow member list "
        "blanks an agent-only row)",
        AGENT_PAGE,
        '  const { resolveActorName } = useActorLookup();',
        "  const { resolveActorName: resolveRaw, resolved } = useActorLookup();\n"
        "  const resolveActorName = (type: string | null | undefined, id: string | null | undefined) =>\n"
        "    resolved ? resolveRaw(type, id) : ({ kind: \"unsettled\" } as const);",
    ),
    (
        "7. the integrations installer row drops its pending flag (an unread "
        "value renders as 'no installer')",
        INTEGRATIONS,
        "        pending={installer.kind === \"unsettled\"}",
        "        pending={false}",
    ),
    (
        "8. the integrations text ignores the decision and reads the raw "
        "lookup",
        INTEGRATIONS,
        "        value={actorNameText(installer)}",
        '        value={getName("member", install.installer_user_id)}',
    ),
    (
        "9. the autopilot subscriber chip goes back to the raw lookup "
        "(「Unknown」 on a cold start)",
        AUTOPILOTS,
        '                  state={resolveActorName("member", s.user_id)}',
        '                  state={{ kind: "name", name: getName("member", s.user_id) }}',
    ),
    (
        "10. the autopilot collaborator row waits on the combined flag",
        AUTOPILOTS,
        '                state={resolveActorName("member", c.user_id)}',
        '                state={{ kind: "name", name: getName("member", c.user_id) }}',
    ),
    (
        "11. the squad leader line prints a string again (an unread agent "
        "directory reads as 'no leader')",
        SQUADS,
        '                    leaderName={resolveActorName("agent", item.leader_id)}',
        '                    leaderName={{ kind: "name", name: getName("agent", item.leader_id) }}',
    ),
    (
        "12. the run transcript header asserts the agent before its directory "
        "answers",
        TRANSCRIPT,
        '                state={resolveActorName("agent", task.agent_id)}',
        '                state={{ kind: "name", name: getName("agent", task.agent_id) }}',
    ),
    (
        "13. the working-agents roster asserts the agent before its directory "
        "answers",
        ROSTER,
        '              state={resolveActorName("agent", agent.id)}',
        '              state={{ kind: "name", name: getName("agent", agent.id) }}',
    ),
    (
        "14. the project detail's lead row waits on both directories (a "
        "member-led project blanks while the agent list loads)",
        PROJECT_PROPS,
        "    catalogsResolved: isActorTypeResolved(resolvedBy, project.lead_type),",
        "    catalogsResolved: resolvedBy.member && resolvedBy.agent,",
    ),
    (
        "15. the project detail's lead row draws its 'no lead' placeholder "
        "while merely pending",
        PROJECT_PROPS,
        '          leadCell.kind === "pending" ? (',
        "          false ? (",
    ),
    # ── the filter chips: text withheld, order settled ──────────────────────
    (
        "16. the lead chip prints a sentinel instead of withholding",
        FILTERS,
        '        label: state.kind === "unsettled" ? null : state.name,',
        '        label: state.kind === "unsettled" ? "Unknown" : state.name,',
    ),
    (
        "17. the lead chip's ORDER follows its withholdable label (chips "
        "reshuffle as directories answer)",
        FILTERS,
        "    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));",
        "    .sort((a, b) => (a.label ?? \"\").localeCompare(b.label ?? \"\"));",
    ),
    (
        "18. the chip's sort key is the label rather than the reference (same "
        "drift, one indirection further out)",
        FILTERS,
        "        sortKey: value,",
        "        sortKey: state.kind === \"unsettled\" ? \"\" : state.name,",
    ),
    (
        "19. a lead option is dropped entirely while unread (the chip — and "
        "the filter it stands for — disappears)",
        FILTERS,
        "  return [...byValue.entries()]\n    .map(([value, { type, id, count }]) => {",
        "  return [...byValue.entries()]\n    .filter(([, { type, id }]) => resolveName(type, id).kind !== \"unsettled\")\n    .map(([value, { type, id, count }]) => {",
    ),
    (
        "20. the projects screen re-sorts the options itself by label (undoes "
        "the helper's stable order at the call site)",
        PROJECTS_SCREEN,
        "    () => leadFilterOptions(data, resolveActorName),",
        "    () =>\n      leadFilterOptions(data, resolveActorName).sort((a, b) =>\n        (a.label ?? \"\").localeCompare(b.label ?? \"\"),\n      ),",
    ),
    # ── the section header: labelled, never blank ───────────────────────────
    (
        "21. the section header goes blank while unread (reads as a rendering "
        "fault)",
        CHROME,
        '        {actorNameText(\n'
        '          resolveActorName(section.assigneeType, section.assigneeId),\n'
        '        ) || t("issues.boardReadingAssignee")}',
        "        {actorNameText(\n"
        "          resolveActorName(section.assigneeType, section.assigneeId),\n"
        "        )}",
    ),
    (
        "22. the section header asserts the actor before its directory answers",
        CHROME,
        "          resolveActorName(section.assigneeType, section.assigneeId),\n"
        "        ) || t(\"issues.boardReadingAssignee\")}",
        '          { kind: "name", name: getName(section.assigneeType, section.assigneeId) },\n'
        '        ) || t("issues.boardReadingAssignee")}',
    ),
    (
        "23. the assignee filter chip withholds (a chip the user just added "
        "vanishes)",
        CHROME,
        '      label: selectedActorLabel({\n'
        "        state: resolveActorName(a.type, a.id),\n"
        "        type: a.type,\n"
        '        fallback: translate("filter.assignee"),\n'
        "      }),",
        '      label: actorNameText(resolveActorName(a.type, a.id)),',
    ),
    (
        "24. the creator filter chip withdraws the same way",
        CHROME,
        '      label: selectedActorLabel({\n'
        "        state: resolveActorName(c.type, c.id),\n"
        "        type: c.type,\n"
        '        fallback: translate("filter.creator"),\n'
        "      }),",
        '      label: actorNameText(resolveActorName(c.type, c.id)),',
    ),
    # ── author lines on surfaces that also index them ───────────────────────
    (
        "25. the thread navigator hands `prepareThreads` the raw resolver, so "
        "an unread author is indexed as 「Unknown」 and drawn as one",
        THREAD_NAV,
        "        (entry) =>\n"
        "          actorNameText(\n"
        "            resolveActorName(\n",
        "        (entry) =>\n"
        "          ((\n"
        "            resolveActorName(\n",
    ),
    (
        "26. the thread navigator's author line goes blank instead of dropping "
        "(a caption-height gap with nothing in it)",
        THREAD_NAV,
        "          {authorName ? (\n"
        '            <Text className="text-caption text-muted-foreground" numberOfLines={1}>\n'
        "              {authorName}\n"
        "            </Text>\n"
        "          ) : null}",
        '          <Text className="text-caption text-muted-foreground" numberOfLines={1}>\n'
        "            {authorName}\n"
        "          </Text>",
    ),
    (
        "27. the deliverables heading leaves its preposition dangling "
        "(「Comment by」 with nothing after it)",
        DELIVERABLES,
        '                        {name\n'
        '                          ? t("deliverables.groupCommentBy", { name })\n',
        '                        {name\n'
        '                          ? t("deliverables.groupCommentBy", { name: "" })\n',
    ),
    (
        "28. the deliverables heading takes a sentinel instead of withholding",
        DELIVERABLES,
        "                const name = actorNameText(resolved);",
        '                const name = actorNameText(resolved) || "Unknown";',
    ),
    (
        "29. the moderated-delete question opens a possessive on nothing",
        CONTEXT_MENU,
        "              isOwn || !authorName",
        "              isOwn",
    ),
    (
        "30. the comment long-press resolves the author twice (the card and the "
        "sheet can disagree)",
        CONTEXT_MENU,
        "    const authorName = actorNameText(\n"
        "      resolveActorName(",
        "    const authorName = getName(\n"
        "      (",
    ),
    (
        "31. the source-context preview re-resolves the FROZEN author name "
        "against a live directory (which may now disagree)",
        SOURCE_CONTEXT,
        "                  {c.author.name ? (",
        "                  {false ? (",
    ),
    (
        "32. the source-context live fallback asserts before its directory "
        "answers",
        SOURCE_CONTEXT,
        "                      state={resolveActorName(\n"
        '                        c.author.type as "member" | "agent",\n'
        "                        c.author.id,\n"
        "                      )}",
        '                      state={{ kind: "name", name: getName(c.author.type as "member", c.author.id) }}',
    ),
    # ── pickers echo ────────────────────────────────────────────────────────
    (
        "33. the single-issue assign dialog withholds its just-picked target",
        PICKER_ASSIGNEE,
        "        name={selectedActorLabel({\n"
        "          state: resolveActorName(assignTarget?.type, assignTarget?.id),\n"
        "          type: assignTarget?.type,\n"
        '          fallback: t("filter.assignee"),\n'
        "        })}",
        "        name={actorNameText(\n"
        "          resolveActorName(assignTarget?.type, assignTarget?.id),\n"
        "        )}",
    ),
    (
        "34. the batch assign dialog withholds the same way",
        BATCH_BAR,
        "        name={selectedActorLabel({\n"
        "          state: resolveActorName(assignTarget?.type, assignTarget?.id),\n"
        "          type: assignTarget?.type,\n"
        '          fallback: t("filter.assignee"),\n'
        "        })}",
        "        name={actorNameText(\n"
        "          resolveActorName(assignTarget?.type, assignTarget?.id),\n"
        "        )}",
    ),
    (
        "35. the quick-create panel drops its set/unset branch, so an absent "
        "actor echoes 「—」 instead of asking the user to pick one",
        QUICK_CREATE,
        "  const actorLabel = actor\n"
        "    ? selectedActorLabel({\n"
        "        state: resolveActorName(actor.type, actor.id),\n"
        "        type: actor.type,\n",
        "  const actorLabel = true\n"
        "    ? selectedActorLabel({\n"
        "        state: resolveActorName(actor?.type, actor?.id),\n"
        "        type: actor?.type,\n",
    ),
    (
        "36. the property editor's field goes blank instead of keeping its own "
        "empty copy",
        PROPERTY_EDITOR,
        '                  ) || t("properties.value.empty")',
        "                  )",
    ),
    (
        "37. the property editor's field joins withheld refs into empty "
        "segments ('Ada, , Grace') by hand instead of through the tested "
        "folding",
        PROPERTY_EDITOR,
        "                  joinedActorNames(\n"
        "                    display.refs.map((ref) => ({\n"
        "                      type: ref.kind,\n"
        "                      id: ref.id,\n"
        "                    })),\n"
        "                    resolveActorName,\n"
        "                    Number.MAX_SAFE_INTEGER,\n"
        "                  ) || t(\"properties.value.empty\")",
        "                  display.refs\n"
        "                    .map((ref) =>\n"
        "                      actorNameText(resolveActorName(ref.kind, ref.id)),\n"
        "                    )\n"
        "                    .join(\", \") || t(\"properties.value.empty\")",
    ),
]


def main() -> int:
    green, tail = run_suite()
    print("baseline:", "GREEN" if green else "RED")
    print(tail)
    if not green:
        print("baseline is not green — fix that before mutating")
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
