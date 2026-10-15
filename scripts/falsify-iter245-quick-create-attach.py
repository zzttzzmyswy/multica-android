#!/usr/bin/env python3
"""Mutation-test iteration 245's attachment path on the agent-mode create panel.

Mobile's new-issue modal has two tabs one segmented control apart: manual
(could always attach a file) and agent (a bare `TextInput` — could not). The
endpoint has always accepted `attachment_ids` (`QuickCreateIssueRequest`) and
the daemon receives them on the task, so the whole gap was client-side wiring.
Each mutation injects ONE defect and asserts the suite turns RED on it; the
restore is asserted GREEN. A guard that cannot be made to fail is not a guard —
the repo's standing discipline (`scripts/falsify-iter*.py`).

The four the acceptance criteria name:

   1. agent-mode submit drops `attachment_ids`
      -> the user attaches a screenshot, the agent gets a prompt referring to a
         file that was never bound: silent loss, no error anywhere
   2. submit is allowed while an upload is still in flight
      -> the id does not exist yet when the payload is built, same silent loss
   3. an unsubmitted attachment id leaks into a different payload
      -> an upload the user cancelled/never referenced gets bound anyway
   4. the upload callback is no longer wired to the collector
      -> uploads succeed, the toolbar shows the link, and nothing reaches the
         server — the exact shape of the bug this iteration fixes

The rest are the invariants the fix's own correctness rests on:

   5. an already-collected id appended twice (double UUID validation)
   6. the empty case emits `attachment_ids: []` instead of omitting the field
   7. the collector is wired to neither body (call-site count drops to 0/1)
   8. the in-flight flag stops reaching the screen
   9. the prompt field reverts to a bare TextInput (no upload entry at all)
  10. the panel stops rendering the rich field
  11. manual mode's own gate is removed (the reference implementation breaks)
  12. manual mode's payload loses its field
  13. the agent prompt is submitted unserialized (raw sentinel text)
  14. a locale value replaced by the other language's

Run: python3 scripts/falsify-iter245-quick-create-attach.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
LIB = APP / "lib" / "quick-create-attachments.ts"
PANEL = APP / "components" / "issue" / "quick-create-panel.tsx"
NEW_ISSUE = APP / "app" / "(app)" / "[workspace]" / "new-issue.tsx"
EN = APP / "lib" / "i18n" / "locales" / "en.json"

SUITE = [
    "lib/quick-create-attachments.test.ts",
    "lib/i18n/iter245-keys.test.ts",
    "data/api-quickcreate.test.ts",
    "lib/i18n/locale-completeness.test.ts",
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
        "1. agent-mode submit drops attachment_ids",
        NEW_ISSUE,
        "        ...attachmentIdsPayload(uploadedAttachmentIds),\n",
        "",
    ),
    (
        "1b. agent-mode submit sends an empty id list instead of the real one",
        NEW_ISSUE,
        "        ...attachmentIdsPayload(uploadedAttachmentIds),",
        "        ...attachmentIdsPayload([]),",
    ),
    (
        "2. submit is allowed while an upload is still in flight",
        LIB,
        "    !input.uploadsPending &&\n",
        "",
    ),
    (
        "2b. the screen feeds the gate a constant for uploadsPending",
        NEW_ISSUE,
        "          uploadsPending,\n        });",
        "          uploadsPending: false,\n        });",
    ),
    (
        "3. a collected id is written into the MANUAL payload's field",
        NEW_ISSUE,
        "        ...(uploadedAttachmentIds.length > 0\n"
        "          ? { attachment_ids: uploadedAttachmentIds }\n"
        "          : {}),",
        "        ...attachmentIdsPayload(uploadedAttachmentIds),",
    ),
    (
        "4. the upload callback is no longer wired to the collector",
        NEW_ISSUE,
        "                onAttachmentUploaded={collectAttachment}\n",
        "                onAttachmentUploaded={() => {}}\n",
    ),
    (
        "5. an already-collected id is appended twice",
        LIB,
        "  return prev.includes(id) ? prev : [...prev, id];",
        "  return [...prev, id];",
    ),
    (
        "6. the empty case emits attachment_ids: [] instead of omitting it",
        LIB,
        "  return ids.length > 0 ? { attachment_ids: ids } : {};",
        "  return { attachment_ids: ids };",
    ),
    (
        "7a. the collector is wired to only one body (agent)",
        NEW_ISSUE,
        "                onAttachmentUploaded={collectAttachment}\n"
        "                onUploadingChange={setUploadsPending}\n"
        "              />\n"
        "              <CreateFormAttributeRow mode=\"manual\" />",
        "                onUploadingChange={setUploadsPending}\n"
        "              />\n"
        "              <CreateFormAttributeRow mode=\"manual\" />",
    ),
    (
        "8. the in-flight flag stops reaching the screen from the agent panel",
        PANEL,
        "        onUploadingChange={onUploadingChange}\n",
        "",
    ),
    (
        "9. the prompt field reverts to a bare TextInput (no upload entry)",
        PANEL,
        "      <DescriptionField\n        description={promptInput}",
        "      <TextInput\n        value={promptInput.text}",
    ),
    (
        "10. the panel stops rendering the rich prompt field entirely",
        PANEL,
        "        onAttachmentUploaded={onAttachmentUploaded}\n"
        "        onUploadingChange={onUploadingChange}\n      />",
        "      />",
    ),
    (
        "11. manual mode's own upload gate is removed",
        NEW_ISSUE,
        "      ? !isSubmitting &&\n        !uploadsPending &&\n        title.trim().length > 0",
        "      ? !isSubmitting &&\n        title.trim().length > 0",
    ),
    (
        "12. manual mode's payload loses its attachment field",
        NEW_ISSUE,
        "        ...(uploadedAttachmentIds.length > 0\n"
        "          ? { attachment_ids: uploadedAttachmentIds }\n"
        "          : {}),\n",
        "",
    ),
    (
        "13. the agent prompt is submitted raw (unserialized sentinel text)",
        NEW_ISSUE,
        "    const trimmedPrompt = promptInput.serialize().trim();",
        "    const trimmedPrompt = promptInput.text.trim();",
    ),
    (
        "14. an en value is replaced by the zh string",
        EN,
        '  "newIssue.agentPlaceholder": "Describe the task in plain language…",',
        '  "newIssue.agentPlaceholder": "用自然语言描述任务，智能体会帮你创建…",',
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
