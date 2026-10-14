#!/usr/bin/env python3
"""Mutation-test iteration 244's two-layer instruction surface (MYS-2162).

A product-defined agent (Mika) carries `system_instructions` — the ~3.5 KB
prompt the server renders from its own binary — beside `instructions`, which
holds only the workspace's own notes. Mobile read neither, so the edit form
labelled the workspace-notes half 「指令」 and said nothing about the other half
existing. Web shows both (`packages/views/agents/components/tabs/instructions-tab.tsx`).

Each mutation injects ONE defect and asserts the suite turns RED on it; the
restore is asserted GREEN. A guard that cannot be made to fail is not a guard —
this is the repo's standing discipline (`scripts/falsify-iter*.py`).

The four the acceptance criteria name:

   1. `hasSystemPromptLayer` written effectively always-true
      -> EVERY ordinary agent grows a read-only "Maintained by Multica" card
         over text the server never sent
   2. the read-only card becomes editable / its value reaches the draft
      -> the product half turns into a second editor, and saving would write it
         back as the workspace's own notes
   3. the switched label and placeholder stop switching with the layer
      -> the card appears but the field below still claims to BE the whole
         prompt, which is the mislabelling this iteration removes
   4. the system half is written into the update request
      -> the product text is persisted onto the agent row, where the next
         release can no longer update it

The rest are the invariants the fix's own correctness rests on:

   5. the layer keyed off `system_key` instead of the payload
      -> a backend that stops sending the text still renders the card
   6. the trim dropped, so a blank value renders an empty card
   7. `systemPromptLayer` returns the EDITABLE half
   8. the copy switch inverted
   9. the layering intro dropped from the layered branch
  10. the layered label collapsed back onto the plain one
  11. the form shows the layer in create / duplicate mode too
  12. the card fed `draft.instructions`
  13. the card's body becomes a text input
  14. the card's body loses its height cap (3.5 KB buries the editable field)
  15. the detail screen renders the block unconditionally
  16. the detail screen drops the workspace-notes half
  17. a zh key removed from the bundle
  18. an en value replaced by the zh string
  19. the schema rewrites absence into an empty string
  20. the schema stops catching a drifted value (null / number from a future
      payload would throw inside the render over one unread field)

Run: python3 scripts/falsify-iter244-system-layer.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
LIB = APP / "lib" / "agent-system-prompt.ts"
CARD = APP / "components" / "agent" / "agent-system-layer-card.tsx"
FORM = APP / "components" / "agent" / "manual-agent-form.tsx"
DETAIL = APP / "app" / "(app)" / "[workspace]" / "more" / "agents" / "[id].tsx"
SCHEMAS = APP / "data" / "schemas.ts"
ZH = APP / "lib" / "i18n" / "locales" / "zh.json"
EN = APP / "lib" / "i18n" / "locales" / "en.json"

SUITE = [
    "lib/agent-system-prompt.test.ts",
    "lib/agent-system-prompt-wiring.test.ts",
    "lib/i18n/iter244-keys.test.ts",
    "lib/i18n/locale-completeness.test.ts",
    "lib/i18n/agents-keys.test.ts",
    "data/agent-system-instructions-schema.test.ts",
]


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
        "1. hasSystemPromptLayer is effectively always-true",
        LIB,
        "  return systemPromptLayer(agent).length > 0;",
        "  return agent != null;",
    ),
    (
        "2a. the card's body becomes an editable text input",
        CARD,
        "          <Text className=\"text-caption leading-5 text-muted-foreground\">\n"
        "            {instructions}\n"
        "          </Text>",
        "          <TextInput\n"
        "            value={instructions}\n"
        "            editable={false}\n"
        "            className=\"text-caption leading-5 text-muted-foreground\"\n"
        "          />",
    ),
    (
        "2b. the card gains an onChange prop the caller can wire to the draft",
        CARD,
        "export function AgentSystemLayerCard({ instructions }: { instructions: string }) {",
        "export function AgentSystemLayerCard({\n"
        "  instructions,\n"
        "  onChange,\n"
        "}: {\n"
        "  instructions: string;\n"
        "  onChange: (next: string) => void;\n"
        "}) {",
    ),
    (
        "2c. the card is fed the editable draft",
        FORM,
        "<AgentSystemLayerCard instructions={systemLayer} />",
        "<AgentSystemLayerCard instructions={draft.instructions} />",
    ),
    (
        "3a. the label stops switching with the layer",
        FORM,
        "<FieldLabel text={t(instructionsCopy.labelKey)} />",
        "<FieldLabel text={t(\"agents.new.instructionsLabel\")} />",
    ),
    (
        "3b. the placeholder stops switching with the layer",
        FORM,
        "placeholder={t(instructionsCopy.placeholderKey)}",
        "placeholder={t(\"agents.new.instructionsPlaceholder\")}",
    ),
    (
        "4. the product half is written into the update request",
        FORM,
        "          buildUpdateAgentRequest({\n            draft,",
        "          buildUpdateAgentRequest({\n            draft,\n"
        "            system_instructions: systemLayer,",
    ),
    (
        "5. the layer is keyed off system_key instead of the payload",
        LIB,
        "  return systemPromptLayer(agent).length > 0;",
        "  return agent?.system_key != null;",
    ),
    (
        "6. the trim is dropped, so a blank value renders an empty card",
        LIB,
        '  return typeof value === "string" ? value.trim() : "";',
        '  return typeof value === "string" ? value : "";',
    ),
    (
        "7. systemPromptLayer returns the EDITABLE half",
        LIB,
        "  const value = agent?.system_instructions;",
        "  const value = agent?.instructions;",
    ),
    (
        "7b. the drift guard is dropped, so a malformed value throws in the render",
        LIB,
        '  return typeof value === "string" ? value.trim() : "";',
        "  return value!.trim();",
    ),
    (
        "8. the copy switch is inverted",
        LIB,
        "  return hasSystemLayer\n    ? AGENT_INSTRUCTIONS_COPY.workspaceNotes\n    : AGENT_INSTRUCTIONS_COPY.plain;",
        "  return hasSystemLayer\n    ? AGENT_INSTRUCTIONS_COPY.plain\n    : AGENT_INSTRUCTIONS_COPY.workspaceNotes;",
    ),
    (
        "9. the layering intro is dropped from the layered branch",
        LIB,
        '    introKey: "agents.instructions.workspaceIntro",',
        "    introKey: null,",
    ),
    (
        "10. the layered label collapses back onto the plain one",
        LIB,
        '    labelKey: "agents.instructions.workspaceLabel",',
        '    labelKey: "agents.new.instructionsLabel",',
    ),
    (
        "11. the form shows the system layer in create / duplicate mode too",
        FORM,
        "  const hasSystemLayer = isEdit && hasSystemPromptLayer(agent);",
        "  const hasSystemLayer = hasSystemPromptLayer(agent);",
    ),
    (
        "12. the layering sentence is no longer rendered",
        FORM,
        "        {instructionsCopy.introKey ? (\n"
        "          <Text className=\"text-caption leading-relaxed text-muted-foreground\">\n"
        "            {t(instructionsCopy.introKey)}\n"
        "          </Text>\n"
        "        ) : null}",
        "        {null}",
    ),
    (
        "13. the card's body loses its height cap",
        CARD,
        'className="max-h-[260px] border-t border-border"',
        'className="border-t border-border"',
    ),
    (
        "14. the detail screen renders the block unconditionally",
        DETAIL,
        "{hasSystemLayer ? (\n            <>\n              <SectionTitle>{t(\"agents.detail.instructions\")}</SectionTitle>",
        "{true ? (\n            <>\n              <SectionTitle>{t(\"agents.detail.instructions\")}</SectionTitle>",
    ),
    (
        "15. the detail screen drops the workspace-notes half",
        DETAIL,
        '{t("agents.instructions.workspaceLabel")}',
        '{t("agents.systemLayer.label")}',
    ),
    (
        "16. a zh key is removed from the bundle",
        ZH,
        '  "agents.systemLayer.hint": "随 Multica 版本更新。你无法编辑这部分，你在下面写的内容也永远不会被覆盖。",\n',
        "",
    ),
    (
        "17. an en value is replaced by the zh string",
        EN,
        '  "agents.instructions.workspaceLabel": "Workspace notes",',
        '  "agents.instructions.workspaceLabel": "工作区补充",',
    ),
    (
        "18. the schema rewrites absence into an empty string",
        SCHEMAS,
        "  system_instructions: z.string().optional().catch(undefined),",
        '  system_instructions: z.string().default(""),',
    ),
    (
        "19. the schema stops catching a drifted value",
        SCHEMAS,
        "  system_instructions: z.string().optional().catch(undefined),",
        "  system_instructions: z.string().optional(),",
    ),
    (
        "20. the detail screen reads the editable half as the product half",
        DETAIL,
        "  const systemLayer = hasSystemLayer ? systemPromptLayer(agent) : \"\";",
        "  const systemLayer = hasSystemLayer ? (agent?.instructions ?? \"\") : \"\";",
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
