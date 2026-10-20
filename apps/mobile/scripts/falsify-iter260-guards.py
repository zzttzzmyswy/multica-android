#!/usr/bin/env python3
"""Mutation-test iteration 260's four fixes (MYS-2253).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, scripts/falsify-*.py).

The four gaps this round closes, and what the mutations attack:

  #1  Creating a project could not set a lead or a schedule, so every
      phone-created project needed a second trip to the detail screen. Web
      offers all three as pills. Mutations: send a bare lead_id with no
      lead_type, drop the "no lead" omission and always send the pair, drop the
      dates from the payload, and drop the picked values from the create
      callback's dependency list (which silently ships the FIRST render's
      closure — no lead, no dates).

  #2  The project description was rendered and edited as PLAIN TEXT while web
      uses a markdown ContentEditor, so markdown source showed verbatim and
      mobile saves wrote literal text back. Mutations: render it with a plain
      <Text>, edit it with a bare textarea, and leave the mention button on
      (a project body has no mention namespace, so an inserted @token resolves
      to nothing).

  #3  A sub-issue's stage could not be set at create time, so phone-created
      children landed in the default stage and broke the stage-barrier
      semantics. Mutations: send the stage even without a parent, read it from
      the PERSISTED draft (replaying parent A's stage onto parent B), stop
      tagging the pick with its parent, mount the chip on root issues too, and
      remove the stage chip entirely.

  #4  The agent detail screen had no "Chat" / "Assign work" actions, so the
      only way to talk to an agent was to leave and reselect it in the chat
      tab. Mutations: hide the chat button when the viewer is denied (an
      absent affordance reads as "this product has no chat"), drop the runtime
      gate so an unbound agent fails on send, drop the archived guard, and
      stop the chat tab reading `?agent=`.

Run: python3 scripts/falsify-iter260-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

# This script lives in `apps/mobile/scripts/`, so the app root is one level up.
APP = Path(__file__).resolve().parent.parent

W = "app/(app)/[workspace]"
NEW_PROJECT = APP / W / "project" / "new.tsx"
EDIT_PROJECT = APP / W / "project" / "[id]" / "edit.tsx"
HEADER_CARD = APP / "components" / "project" / "project-header-card.tsx"
NEW_ISSUE = APP / W / "new-issue.tsx"
ATTR_ROW = APP / "components" / "issue" / "create-form-attribute-row.tsx"
STAGE_STORE = APP / "data" / "stores" / "new-issue-stage-pick-store.ts"
AGENT_ACTIONS = APP / "components" / "agent" / "agent-primary-actions.tsx"
PRIMARY_LIB = APP / "lib" / "agent-primary-actions.ts"
CHAT_TAB = APP / W / "(tabs)" / "chat.tsx"

SUITE = [
    "lib/iter260-wiring.test.ts",
    "lib/agent-primary-actions.test.ts",
    "data/stores/new-issue-stage-pick-store.test.ts",
    "lib/markdown/project-description-roundtrip.test.ts",
]


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
    proc = subprocess.run(
        [str(APP.parent.parent / "node_modules" / ".bin" / "vitest"), "run", *SUITE],
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
    # ── #1 project create: lead + dates ─────────────────────────────────────
    (
        "1. the lead is written as a bare lead_id, leaving the server unable "
        "to tell a member lead from an agent lead",
        NEW_PROJECT,
        "...(lead ? { lead_type: lead.type, lead_id: lead.id } : {}),",
        "...(lead ? { lead_id: lead.id } : {}),",
    ),
    (
        "2. the lead pair is sent even when nothing was picked (lead_id: "
        "undefined) instead of being omitted",
        NEW_PROJECT,
        "...(lead ? { lead_type: lead.type, lead_id: lead.id } : {}),",
        "lead_type: lead?.type, lead_id: lead?.id,",
    ),
    (
        "3. the start date never reaches the create payload",
        NEW_PROJECT,
        "...(startDate ? { start_date: startDate } : {}),",
        "",
    ),
    (
        "4. the due date never reaches the create payload",
        NEW_PROJECT,
        "...(dueDate ? { due_date: dueDate } : {}),",
        "",
    ),
    (
        "5. the create callback omits the picked values from its dependency "
        "list, so it ships the first render's closure — no lead, no dates",
        NEW_PROJECT,
        "    // The create-time lead and schedule. Leaving these out would send a\n"
        "    // payload built from the values captured on the first render — i.e. no\n"
        "    // lead and no dates, which is exactly the bug this iteration fixes.\n"
        "    lead,\n    startDate,\n    dueDate,\n",
        "",
    ),
    (
        "6. the lead chip stops opening the lead picker, so the field is "
        "visible but dead — the user still cannot set a lead while creating",
        NEW_PROJECT,
        'onPress={() => openPicker("lead")}',
        'onPress={() => {}}',
    ),

    # ── #2 project description is markdown ──────────────────────────────────
    (
        "7. the detail screen renders the stored markdown as plain text, so "
        "'## Goals' shows verbatim",
        HEADER_CARD,
        "            <Markdown content={project.description} />",
        "            <Text selectable>{project.description}</Text>",
    ),
    (
        "8. the edit screen goes back to a plain textarea, so markdown shows "
        "as source and saves back as literal text",
        EDIT_PROJECT,
        "                <DescriptionField\n"
        "                  description={descriptionInput}",
        "                <AutosizeTextArea\n"
        "                  value={descriptionInput.text}\n"
        "                  onChangeText={descriptionInput.setText}",
    ),
    (
        "9. the mention button stays on a body with no mention namespace",
        EDIT_PROJECT,
        "                  showMentionButton={false}\n",
        "",
    ),

    # ── #3 sub-issue stage at create time ───────────────────────────────────
    (
        "10. the stage is sent even on a rootless issue — a write the detail "
        "page can never display",
        NEW_ISSUE,
        "...(parent && stage != null ? { stage } : {}),",
        "...(stage != null ? { stage } : {}),",
    ),
    (
        "11. the stage is read from a plain constant instead of the "
        "parent-tagged pick store, so every sub-issue is filed into Stage 1",
        NEW_ISSUE,
        "  const stage = useNewIssueStagePickStore((s) => s.stageFor(parent));",
        "  const stage = 1;",
    ),
    (
        "12. the picked stage is no longer tagged with its parent, so any "
        "picked value leaks to every later issue",
        STAGE_STORE,
        "      return picked && picked.parentId === parentId ? picked.stage : null;",
        "      return picked ? picked.stage : null;",
    ),
    (
        "13. the stage chip mounts on root issues too",
        ATTR_ROW,
        "        {parentIssueId ? (",
        "        {true ? (",
    ),
    (
        "14. the stage chip always shows the placeholder label, so the value "
        "the user picked is invisible",
        ATTR_ROW,
        '                stage == null ? t("attr.stage") : t("stage.value", { n: stage })',
        '                t("attr.stage")',
    ),
    (
        "15. the form stops passing the chosen parent down to the attribute "
        "row, so the chip can never mount",
        NEW_ISSUE,
        "<CreateFormAttributeRow mode=\"manual\" parentIssueId={parent ?? null} />",
        "<CreateFormAttributeRow mode=\"manual\" />",
    ),

    # ── #4 agent detail primary actions ─────────────────────────────────────
    (
        "16. chat is hidden when the viewer is denied, so the press can never "
        "explain WHY (an absent button reads as a missing feature)",
        PRIMARY_LIB,
        "  return { chat: true, assign: canAssign };",
        "  return { chat: canAssign, assign: canAssign };",
    ),
    (
        "17. the runtime gate is dropped, so chat/assign proceed against an "
        "agent with no runtime and fail on send",
        PRIMARY_LIB,
        "  if (!runtimeBound) return { kind: \"blocked\", reason: \"runtime_required\" };\n"
        "  return { kind: \"proceed\" };\n"
        "}\n\n"
        "/**\n"
        " * Decision for \"Assign work\".",
        "  return { kind: \"proceed\" };\n"
        "}\n\n"
        "/**\n"
        " * Decision for \"Assign work\".",
    ),
    (
        "18. an archived agent still offers both actions, starting runs "
        "against an agent that cannot take one",
        PRIMARY_LIB,
        "  if (archived) return { chat: false, assign: false };",
        "  if (archived) return { chat: canAssign, assign: canAssign };",
    ),
    (
        "19. 'loading' is reported as a PERMISSION DENIAL, telling a real "
        "member they have no access",
        PRIMARY_LIB,
        "  if (permissionsLoading) return { kind: \"blocked\", reason: \"permissions_loading\" };\n"
        "  if (!canAssign) return { kind: \"blocked\", reason: \"no_permission\" };\n"
        "  if (!runtimeBound) return { kind: \"blocked\", reason: \"runtime_required\" };\n"
        "  return { kind: \"proceed\" };\n"
        "}\n\n"
        "/**\n"
        " * Decision for \"Assign work\".",
        "  if (!canAssign) return { kind: \"blocked\", reason: \"no_permission\" };\n"
        "  if (!runtimeBound) return { kind: \"blocked\", reason: \"runtime_required\" };\n"
        "  return { kind: \"proceed\" };\n"
        "}\n\n"
        "/**\n"
        " * Decision for \"Assign work\".",
    ),
    (
        "20. the assign action opens the create form with no agent preset, so "
        "'Assign work' lands on a blank form",
        AGENT_ACTIONS,
        "      params: { workspace: wsSlug, seedAgentId: agent.id },",
        "      params: { workspace: wsSlug },",
    ),
    (
        "21. the chat action builds a href without the agent query param, "
        "landing on whichever agent sorts first",
        PRIMARY_LIB,
        "  return `/${wsSlug}/chat?agent=${encodeURIComponent(agentId)}`;",
        "  return `/${wsSlug}/chat`;",
    ),
    (
        "22. the chat tab stops reading the ?agent= param, so the deep link "
        "lands on a blank conversation",
        CHAT_TAB,
        "    if (appliedAgentParamRef.current === agentParam) return;\n"
        "    if (!availableAgents.some((a) => a.id === agentParam)) return;\n"
        "    appliedAgentParamRef.current = agentParam;\n"
        "    setSelectedAgentId(agentParam);\n"
        "    setActiveSessionId(null);",
        "    appliedAgentParamRef.current = agentParam;",
    ),
    (
        "23. the chat tab honours an agent the viewer cannot invoke, leaving "
        "the composer pointed at an actor that fails on send",
        CHAT_TAB,
        "    if (!availableAgents.some((a) => a.id === agentParam)) return;\n"
        "    appliedAgentParamRef.current = agentParam;",
        "    appliedAgentParamRef.current = agentParam;",
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
