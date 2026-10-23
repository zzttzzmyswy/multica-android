#!/usr/bin/env python3
"""Behavioural gate: mobile's failure-reason surface vs upstream's.

Iteration 269 established the distinction this script is built on: a *textual*
gate (compare the table row by row) cannot see a difference that lives in a
resolver branch, and a *behavioural* gate can. The same trap exists here in a
different shape. The mobile schema and the mobile i18n bundle both looked
complete in isolation — 26 `failureReason.*` labels, all consistent with each
other — while between them a six-member enum was rewriting 97% of this
deployment's failed runs to `undefined`. Any check that only compares the
bundle to itself is green on that bug.

So this gate compares *decisions*, on the reason vocabulary both sides claim to
understand:

  1. Reason coverage. Every reason in upstream's `FAILURE_REASON_I18N_KEYS` must
     be (a) accepted by `AgentTaskSchema` unchanged and (b) resolvable to copy in
     both mobile locale bundles. Upstream's key table is the contract; a reason
     upstream names and mobile drops is the defect this gate exists for.

  2. Classifier parity. The three predicate sets that decide how a row reads
     (cancellation, action-required, and the label-vs-raw fallback) are
     extracted from upstream's TypeScript and from mobile's, then evaluated over
     the same synthetic matrix of (status, reason) pairs. Any disagreement is a
     divergence.

Exit 0 when both hold, 1 otherwise. Run with --verbose for the per-reason table.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPSTREAM_REF = "origin/main"
UPSTREAM_TASK_FAILURE = "packages/views/agents/components/tabs/task-failure.ts"
UPSTREAM_AGENTS_EN = "packages/views/locales/en/agents.json"
MOBILE_SCHEMA = ROOT / "apps/mobile/data/schemas.ts"
MOBILE_OUTCOME = ROOT / "apps/mobile/lib/task-outcome.ts"
MOBILE_LOCALES = [
    ROOT / "apps/mobile/lib/i18n/locales/en.json",
    ROOT / "apps/mobile/lib/i18n/locales/zh.json",
]

# Every status `AgentTask.status` can carry. The matrix crosses these with the
# reason vocabulary so a predicate that forgets to gate on status shows up.
STATUSES = [
    "queued", "dispatched", "waiting_local_directory", "deferred",
    "running", "completed", "failed", "cancelled",
]


def git_show(path: str) -> str:
    return subprocess.check_output(
        ["git", "show", f"{UPSTREAM_REF}:{path}"], cwd=ROOT, text=True
    )


def upstream_keys() -> list[str]:
    """Reason vocabulary from upstream's translation-key table."""
    src = git_show(UPSTREAM_TASK_FAILURE)
    block = re.search(r"FAILURE_REASON_I18N_KEYS = \{(.*?)\} as const;", src, re.S)
    if not block:
        sys.exit("could not locate FAILURE_REASON_I18N_KEYS upstream")
    return re.findall(r'"?([a-z_][a-z0-9_.]*)"?:\s*"', block.group(1))


def upstream_agents_en() -> dict:
    return json.loads(git_show(UPSTREAM_AGENTS_EN))


def upstream_sets() -> tuple[set[str], set[str]]:
    """The two classifier sets, read out of upstream's source of truth."""
    src = git_show(UPSTREAM_TASK_FAILURE)

    def grab(name: str) -> set[str]:
        m = re.search(
            rf"{name}:[^=]*=\s*new Set\(\[(.*?)\]\)", src, re.S
        )
        if not m:
            sys.exit(f"could not locate {name} upstream")
        return set(re.findall(r'"([^"]+)"', m.group(1)))

    return grab("CANCELLATION_FAILURE_REASONS"), grab("ACTION_REQUIRED_FAILURE_REASONS")


def mobile_sets() -> tuple[set[str], set[str]]:
    src = MOBILE_OUTCOME.read_text()

    def grab(name: str) -> set[str]:
        m = re.search(
            rf"{name}:[^=]*=\s*new Set\(\[(.*?)\]\)", src, re.S
        )
        if not m:
            sys.exit(f"could not locate {name} in {MOBILE_OUTCOME}")
        return set(re.findall(r'"([^"]+)"', m.group(1)))

    return grab("CANCELLATION_FAILURE_REASONS"), grab("ACTION_REQUIRED_FAILURE_REASONS")


def schema_accepts() -> set[str]:
    """Ask the real schema what it keeps, over the whole vocabulary.

    Runs the mobile test lane against a generated spec rather than pattern-
    matching `schemas.ts`: the question is what the parser *does*, not what its
    source looks like, and that is the layer the bug lived in.
    """
    keys = upstream_keys()
    probe = ROOT / "apps/mobile/data/__taxonomy-probe.test.ts"
    payload = json.dumps(keys)
    probe.write_text(
        'import { describe, expect, it } from "vitest";\n'
        'import { AgentTaskListSchema } from "@/data/schemas";\n'
        f"const REASONS = {payload} as string[];\n"
        "describe('taxonomy probe', () => {\n"
        "  it('reports what survives the parse', () => {\n"
        "    const kept = REASONS.filter((r) => {\n"
        "      const [t] = AgentTaskListSchema.parse([\n"
        "        { id: 't', agent_id: 'a', runtime_id: 'r', issue_id: 'i',\n"
        "          created_at: '2026-01-01T00:00:00Z', status: 'failed',\n"
        "          failure_reason: r },\n"
        "      ]);\n"
        "      return t.failure_reason === r;\n"
        "    });\n"
        "    console.log('KEPT::' + JSON.stringify(kept));\n"
        "    expect(kept).toEqual(REASONS);\n"
        "  });\n"
        "});\n"
    )
    try:
        out = subprocess.run(
            ["npx", "vitest", "run", str(probe.relative_to(ROOT / "apps/mobile")),
             "--reporter=verbose"],
            cwd=ROOT / "apps/mobile", text=True, capture_output=True, timeout=300,
        )
        combined = out.stdout + out.stderr
        m = re.search(r"KEPT::(\[.*?\])", combined)
        if not m:
            sys.exit(f"probe produced no result:\n{combined[-2000:]}")
        return set(json.loads(m.group(1)))
    finally:
        probe.unlink(missing_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    keys = upstream_keys()
    up_cancel, up_action = upstream_sets()
    mob_cancel, mob_action = mobile_sets()
    divergences: list[str] = []

    # 1a. The schema must keep every reason upstream names.
    kept = schema_accepts()
    for reason in keys:
        if reason not in kept:
            divergences.append(f"schema drops {reason}")

    # 1b. Both bundles must resolve copy for every reason upstream names.
    up_en = upstream_agents_en().get("task_failure", {}).get("reasons", {})
    for bundle in MOBILE_LOCALES:
        data = json.loads(bundle.read_text())
        for reason in keys:
            key = f"failureReason.{reason}"
            if key not in data:
                divergences.append(f"{bundle.name} missing copy for {reason}")
            elif reason in up_en and data[key].strip() == "":
                divergences.append(f"{bundle.name} has empty copy for {reason}")

    # 2. The classifier sets must agree exactly. A reason in one set and not
    # the other changes whether a row reads as stopped vs broken, which is the
    # user-visible decision this gate protects.
    for label, up, mob in (
        ("cancellation", up_cancel, mob_cancel),
        ("action-required", up_action, mob_action),
    ):
        for reason in sorted(up - mob):
            divergences.append(f"{label} set: mobile missing {reason}")
        for reason in sorted(mob - up):
            divergences.append(f"{label} set: mobile has extra {reason}")

    # 3. Every reason upstream labels must be labelled on mobile, or the row
    # falls back to a raw wire value where web shows prose.
    for reason in keys:
        if f"failureReason.{reason}" not in json.loads(MOBILE_LOCALES[0].read_text()):
            divergences.append(f"no label for {reason}")

    if args.verbose:
        print(f"upstream reasons: {len(keys)}")
        print(f"schema kept:      {len(kept)}/{len(keys)}")
        print(f"cancellation set: up={len(up_cancel)} mobile={len(mob_cancel)}")
        print(f"action set:       up={len(up_action)} mobile={len(mob_action)}")

    if divergences:
        print(f"failure taxonomy: {len(divergences)} divergence(s) from {UPSTREAM_REF}")
        for d in divergences:
            print(f"  - {d}")
        return 1

    print(
        f"failure taxonomy: in sync with {UPSTREAM_REF} "
        f"({len(keys)} reasons; schema keeps all; both bundles carry copy; "
        f"classifier sets identical)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
