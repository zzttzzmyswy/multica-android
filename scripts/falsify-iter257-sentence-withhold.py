#!/usr/bin/env python3
"""Mutation-test iteration 257's "a name inside a sentence retreats at the
SENTENCE level" change (MYS-2228).

Iterations 254–256 wired every surface where an actor's name is its own text
node: a table cell, a property row, an author line, an avatar's initials. What
they all left alone was the family where the name is an ARGUMENT of an i18n
template — `t("wakeups.cond.assignee", { name })`. That shape cannot simply
withhold: 「当此任务指派给 时」 is a template with its parameter missing, which a
reader takes for a rendering fault rather than for "the directory has not
answered".

So this round had to make a second decision, and it is the one every mutation
below attacks:

  - an ASSERTION (a rule read back from the server) retreats the WHOLE
    sentence to one that names nobody;
  - an ECHO (a value the user picked one tap ago) keeps the sentence whole and
    puts the assignment TYPE's noun where the name goes, because withdrawing a
    value the user just chose reads as "my choice was lost";
  - both agree again the moment the directory answers.

The failure modes are specific to the sentence shape, which is what makes this
round mutatable in ways 254–256 were not:

  - the fallback applied to the NAME SLOT only, leaving a hole mid-sentence;
  - the `actorName` dep left as `=> string`, so the "name or nothing" decision
    goes back to being made separately at each of five call sites — the exact
    drift `lib/actor-name-state.ts` exists to retire;
  - assertion and echo swapped, so a server-read rule claims a type it never
    verified, or the create form blanks a value the user just picked;
  - the retreat reusing `wakeups.conditions.assigneeChanged`, which describes a
    BROADER rule than the `issue_field/assignee` condition actually stored;
  - a `gone` actor withheld like an unread one, losing which actor is gone;
  - the archive sheet sorting on its withholdable label again, so rows
    reshuffle as directories land;
  - the archive row drawing a blank instead of a load mark, or its checkbox
    losing the only words a screen reader has left;
  - the echo sentence falling back to the caller's EMPTY-state copy, so a
    configured field reads as unconfigured;
  - the echo producing an empty string, which is the hole with extra steps.

Each mutation injects exactly ONE such half-defect and asserts the suite turns
RED; the restore is then asserted GREEN. A guard that cannot be made to fail is
not a guard (the repo's standing discipline, `scripts/falsify-*.py`).

Run: python3 scripts/falsify-iter257-sentence-withhold.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
PRESENTATION = APP / "lib" / "wakeup-presentation.ts"
DECISIONS = APP / "lib" / "actor-name-state.ts"
ARCHIVE_VIEW = APP / "lib" / "inbox-archive-view.ts"
ARCHIVE_SHEET = APP / "components" / "inbox" / "inbox-archive-filter-sheet.tsx"
RUN_HINT = APP / "components" / "issue" / "create-run-hint.tsx"
NEW_ISSUE = APP / "app" / "(app)" / "[workspace]" / "new-issue.tsx"
SECTION = APP / "components" / "issue" / "wakeups-section.tsx"
BADGE = APP / "components" / "issue" / "issue-wakeup-header-badge.tsx"
WORKSPACE = APP / "lib" / "use-workspace-wakeups.ts"
CREATE_SHEET = APP / "components" / "issue" / "wakeup-create-sheet.tsx"
LOCALE_EN = APP / "lib" / "i18n" / "locales" / "en.json"
LOCALE_ZH = APP / "lib" / "i18n" / "locales" / "zh.json"

SUITE = [
    "lib/wakeup-sentence-withhold.test.ts",
    "lib/actor-sentence-wiring.test.ts",
    "lib/inbox-archive-view.test.ts",
    "lib/i18n/iter257-keys.test.ts",
    "lib/actor-name-state.test.ts",
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
    # ── the sentence-level retreat: what this round added ────────────────────
    (
        "1. the assertion voice withholds the NAME SLOT instead of the "
        "sentence (「指派给 时」 — a template with its argument missing)",
        PRESENTATION,
        '          if (state.kind === "unsettled") {\n'
        "            // ECHO (the create form's own readback): keep the sentence whole\n"
        "            // and put the type's noun where the name goes. ASSERT (anything\n"
        "            // read back from the server): retreat to the sentence that names\n"
        "            // nobody — a noun there would read as \"assigned to some agent\",\n"
        "            // which is a fact about the rule this client has not verified.\n"
        '            if (deps.actorNameContext === "echo") {\n'
        "              return t(`${K}.assignee`, {\n"
        "                name: selectedActorLabel({ state, type: c.assignee_type }),\n"
        "              });\n"
        "            }\n"
        "            return t(`${K}.assigneeUnread`);\n"
        "          }",
        '          if (state.kind === "unsettled") {\n'
        "            return t(`${K}.assignee`, { name: \"\" });\n"
        "          }",
    ),
    (
        "2. the assertion voice answers with a type noun instead of "
        "retreating (claims the rule is assigned to SOME agent)",
        PRESENTATION,
        '            return t(`${K}.assigneeUnread`);',
        "            return t(`${K}.assignee`, {\n"
        "              name: selectedActorLabel({ state, type: c.assignee_type }),\n"
        "            });",
    ),
    (
        "3. the echo withholds like an assertion (the create form's own "
        "readback opens a hole in a sentence the user just configured)",
        PRESENTATION,
        '            if (deps.actorNameContext === "echo") {',
        "            if (false) {",
    ),
    (
        "4. the retreat reuses assigneeChanged, which is a BROADER rule than "
        "the issue_field/assignee condition actually stored",
        PRESENTATION,
        '            return t(`${K}.assigneeUnread`);',
        '            return t("wakeups.conditions.assigneeChanged");',
    ),
    (
        "5. a settled-but-gone assignee is withheld like an unread one (the "
        "sentence stops saying WHICH actor is gone)",
        PRESENTATION,
        '          if (state.kind === "unsettled") {',
        '          if (state.kind !== "name") {',
    ),
    (
        "6. the actorName dep goes back to `=> string`, so the name-or-nothing "
        "decision is made separately at each call site",
        PRESENTATION,
        "  actorName?: (type: string, id: string) => ActorNameState;",
        "  actorName?: (type: string, id: string) => string;",
    ),
    (
        "7. the sentence stops forwarding the condition's own assignee_type "
        "and hardcodes an agent (a squad condition waits on the wrong read)",
        PRESENTATION,
        "            ? deps.actorName(c.assignee_type, c.assignee_id)",
        '            ? deps.actorName("agent", c.assignee_id)',
    ),
    # ── the four bundles that build WakeupTextDeps ──────────────────────────
    (
        "8. the issue section reads the raw lookup again (a server-read rule "
        "asserts a fallback name on a cold start)",
        SECTION,
        "    actorName: (type: string, id: string) => resolveActorName(type, id),",
        '    actorName: (type: string, id: string) => ({ kind: "name", name: getName(type, id) }),',
    ),
    (
        "9. the header chip reads the raw lookup again (its label is also its "
        "accessibility label, so a screen reader asserts it too)",
        BADGE,
        "    actorName: (type: string, id: string) => resolveActorName(type, id),",
        '    actorName: (type: string, id: string) => ({ kind: "name", name: getName(type, id) }),',
    ),
    (
        "10. the workspace controller reads the raw lookup again",
        WORKSPACE,
        "      actorName: (type: string, id: string) => resolveActorName(type, id),",
        '      actorName: (type: string, id: string) => ({ kind: "name", name: getName(type, id) }),',
    ),
    (
        "11. the create form's bundle loses its echo context, so a value the "
        "user just picked is withdrawn",
        CREATE_SHEET,
        '      actorNameContext: "echo",',
        '      actorNameContext: "assert",',
    ),
    (
        "12. an ASSERTION bundle opts into echo (a rule the client read back "
        "claims a type it never verified)",
        SECTION,
        "    actorName: (type: string, id: string) => resolveActorName(type, id),",
        '    actorNameContext: "echo",\n'
        "    actorName: (type: string, id: string) => resolveActorName(type, id),",
    ),
    # ── the echo sites ─────────────────────────────────────────────────────
    (
        "13. the run caption withholds its just-picked assignee (the caption "
        "loses its subject)",
        RUN_HINT,
        "  const name = selectedActorLabel({",
        "  const name = actorNameText({",
    ),
    (
        "14. the run caption falls back to the caller's EMPTY-state copy, so a "
        "configured field reads as unconfigured",
        RUN_HINT,
        "    fallback:\n"
        '      assigneeType === "squad" ? t("picker.squad") : t("picker.agent"),',
        '    fallback: t("wakeups.create.choose_agent"),',
    ),
    (
        "15. the sent-confirmation dialog opens a hole where the actor goes "
        "(「Task created and handed to .」)",
        NEW_ISSUE,
        "          name: selectedActorLabel({",
        "          name: actorNameText({",
    ),
    (
        "16. the confirmation stops following the assignment TYPE, so a squad "
        "is confirmed as an agent",
        NEW_ISSUE,
        '            fallback:\n'
        '              agentActor.type === "squad"\n'
        '                ? t("picker.squad")\n'
        '                : t("picker.agent"),',
        '            fallback: t("picker.agent"),',
    ),
    # ── the archive filter's label / sort-key split ─────────────────────────
    (
        "17. the archive rows sort on their withholdable label again (rows "
        "reshuffle as directories answer)",
        ARCHIVE_VIEW,
        "    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));",
        '    .sort((a, b) => (a.label ?? "").localeCompare(b.label ?? ""));',
    ),
    (
        "18. the archive row's sort key becomes the label (same drift, one "
        "indirection further out)",
        ARCHIVE_VIEW,
        "        sortKey: key,",
        "        sortKey: settled ? (state.name ?? key) : key,",
    ),
    (
        "19. the archive rows print a sentinel instead of withholding",
        ARCHIVE_VIEW,
        "        label: !settled\n          ? null",
        '        label: !settled\n          ? "Unknown"',
    ),
    (
        "20. the archive rows wait on the COMBINED readiness (a slow member "
        "list blanks the agent rows too)",
        ARCHIVE_VIEW,
        "          : actorNameState({ type, id, name: nameOf(type, id), readiness });",
        "          : actorNameState({\n"
        "              type,\n"
        "              id,\n"
        "              name: nameOf(type, id),\n"
        "              readiness: {\n"
        "                member: readiness.member && readiness.agent,\n"
        "                agent: readiness.member && readiness.agent,\n"
        "                squad: readiness.squad,\n"
        "              },\n"
        "            });",
    ),
    (
        "21. the archive rows withhold the SYSTEM bucket too (a constant that "
        "no directory answers for is never stated)",
        ARCHIVE_VIEW,
        "        type === \"system\"\n          ? SYSTEM_ACTOR_STATE",
        "        type === \"system\"\n          ? { kind: \"unsettled\" as const }",
    ),
    (
        "22. a selected actor drops out of the list while unread (its checkbox "
        "— and the filter it stands for — disappears)",
        ARCHIVE_VIEW,
        "  const keys = [\n"
        "    ...new Set<string>([...Object.keys(facetActors ?? {}), ...selected]),\n"
        "  ];",
        "  const keys = [...new Set<string>([...Object.keys(facetActors ?? {})])];",
    ),
    (
        "23. the archive row draws a blank instead of a load mark (the row "
        "collapses to an icon and a count)",
        ARCHIVE_SHEET,
        "      {label === null ? (",
        "      {false ? (",
    ),
    (
        "24. the unread archive row loses its accessibility name (a checkbox "
        "that announces only 「, 12」)",
        ARCHIVE_SHEET,
        '      accessibilityLabel={`${label ?? unreadAccessibilityName ?? ""}, ${count}`}',
        '      accessibilityLabel={`${label ?? ""}, ${count}`}',
    ),
    (
        "24b. the accessibility override is put AHEAD of the label, so every "
        "settled row announces 「来自, 118」 and loses its actor (found on the "
        "device during this round's own A/B)",
        ARCHIVE_SHEET,
        '      accessibilityLabel={`${label ?? unreadAccessibilityName ?? ""}, ${count}`}',
        '      accessibilityLabel={`${unreadAccessibilityName ?? label ?? ""}, ${count}`}',
    ),
    # ── the i18n shape the retreat depends on ──────────────────────────────
    (
        "25. the en retreat sentence grows a placeholder, putting the hole back",
        LOCALE_EN,
        '  "wakeups.cond.assigneeUnread": "When this issue is assigned to someone",',
        '  "wakeups.cond.assigneeUnread": "When this issue is assigned to {{name}}",',
    ),
    (
        "26. the zh retreat sentence names an actor again (the same unbacked "
        "claim in another spelling)",
        LOCALE_ZH,
        '  "wakeups.cond.assigneeUnread": "当此任务指派给某个人时",',
        '  "wakeups.cond.assigneeUnread": "当此任务指派给某个智能体时",',
    ),
    # ── the echo primitive the two run-confirm sites share ─────────────────
    (
        "27. selectedActorLabel returns an empty string for an unread echo "
        "(the hole with extra steps)",
        DECISIONS,
        "    fallback || ECHO_FALLBACK_BY_TYPE[type as ActorType] || ECHO_UNKNOWN_NOUN",
        '    fallback || ""',
    ),
    (
        "28. an echo answers with a sentinel instead of a type noun (the fix "
        "becomes the defect it replaced)",
        DECISIONS,
        "    fallback || ECHO_FALLBACK_BY_TYPE[type as ActorType] || ECHO_UNKNOWN_NOUN",
        '    fallback || "Unknown"',
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
