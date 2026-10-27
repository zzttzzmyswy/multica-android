#!/usr/bin/env python3
"""Mutation-test iteration 275's two fixes (MYS-2415).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, scripts/falsify-*.py).

The two gaps this round closes, and what the mutations attack:

  #1  A time wakeup rule's label already ends in "wake" (`Wake every hour`,
      `每小时唤醒`), and the created-entry sentence appended the generic
      `· wake {{agent}}` tail on top of it — Chinese rendered
      「添加了唤醒：每小时唤醒唤醒 Agent One」. Upstream MUL-8220 gave time rules
      an agent-first sentence. Mobile now picks it on
      `preview && !preview.condition && preview.kind !== "event"`.
      Mutations: route every kind down the new branch (which silently drops the
      wake action from `event` rules), route no kind down it (the original bug),
      drop the `kind` test (event rules carry a condition, so this is the
      redundant half), and drop the `condition` test (a condition-less event
      rule would take the time sentence).

  #2  Bedrock reports Anthropic ids as `<region>.anthropic.<id>` with an
      inference-profile version on snapshots. `canonicalCandidates` only peeled
      `/` and `:` routing prefixes, so the vendor/region prefix survived into
      the lookup key and every Bedrock-served turn priced at $0.00 while its
      tokens were still counted in `task_usage`. Upstream MUL-8269 strips it.
      DeepSeek-V4.1-Flash was missing from the table for the same "shows $0"
      reason. Mutations: drop the strip entirely, strip non-Anthropic vendors
      too (the over-charge direction: Nova borrows a Claude rate), drop the
      profile-version removal, drop the candidate from the list, and revert the
      DeepSeek rows.

Run: python3 scripts/falsify-iter275-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"

FORMAT_ACTIVITY = APP / "lib" / "format-activity.ts"
PRICING = APP / "lib" / "model-pricing.ts"

SUITE = [
    "lib/format-activity-wakeup.test.ts",
    "lib/model-pricing.test.ts",
]


def run_mobile() -> tuple[bool, str]:
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
    # ── #1 the repeated "wake" ─────────────────────────────────────────────
    (
        "1. every kind takes the agent-first sentence, so an `event` rule loses "
        "the wake action it exists to state — the over-correction upstream's "
        "three-way predicate exists to prevent",
        FORMAT_ACTIVITY,
        'return preview && !preview.condition && preview.kind !== "event"',
        "return preview !== null",
    ),
    (
        "2. no kind takes it — the shipped defect, restored: Chinese reads "
        "「添加了唤醒：每小时唤醒唤醒 Agent One」 again",
        FORMAT_ACTIVITY,
        'return preview && !preview.condition && preview.kind !== "event"\n'
        '        ? translate("activity.wakeupCreatedScheduled", { condition, agent })\n'
        '        : translate("activity.wakeupCreated", { condition, agent });',
        'return translate("activity.wakeupCreated", { condition, agent });',
    ),
    (
        "3. the `kind` half of the predicate is dropped, leaving `!condition` "
        "alone to separate time rules from conditional ones — an event rule "
        "stored without its condition takes the time sentence",
        FORMAT_ACTIVITY,
        'return preview && !preview.condition && preview.kind !== "event"',
        "return preview && !preview.condition",
    ),
    (
        "4. the `condition` half is dropped, leaving only the kind test — the "
        "redundant-looking guard, kept because a rule can carry BOTH a kind and "
        "a condition, and the condition is what the sentence must lead with",
        FORMAT_ACTIVITY,
        'return preview && !preview.condition && preview.kind !== "event"',
        'return preview && preview.kind !== "event"',
    ),
    # ── #2 Bedrock ids and DeepSeek-V4.1-Flash ─────────────────────────────
    (
        "5. the Bedrock strip is a no-op, so `us.anthropic.claude-sonnet-5` "
        "misses every row and renders $0.00 while its tokens are still billed",
        PRICING,
        "  const stripBedrock = (s: string) => {",
        "  const stripBedrock = (s: string) => {\n    if (s) return s;",
    ),
    (
        "6. the strip takes ANY vendor, so `us.amazon.nova-pro-v1:0` becomes "
        "`nova-pro` and — via a near-named row — borrows a Claude rate: a "
        "silent over-charge on every Nova request",
        PRICING,
        "    const prefix = /^(?:(?:us|eu|apac|global)\\.)?anthropic\\.(claude-)/;",
        "    const prefix = /^(?:(?:us|eu|apac|global)\\.)?[a-z]+\\.(claude-|[a-z]+-)/;",
    ),
    (
        "7. the profile version survives, so every Bedrock SNAPSHOT id "
        "(`…-4-5-20250929-v1:0`) stays unpriced even though the family row "
        "exists — the strip looks wired and half the traffic is still $0",
        PRICING,
        '    return s.replace(prefix, "$1").replace(/-v\\d+:\\d+(\\[[^\\]]+\\])?$/, "$1");',
        '    return s.replace(prefix, "$1");',
    ),
    (
        "8. the normalized candidate is computed and never pushed, so the "
        "resolver is correct and unreachable — the shape that passes review "
        "and fixes nothing on a device. BOTH bedrock pushes go: one is "
        "`bedrock`, the other `stripDate(bedrock)`, and removing only the "
        "first still resolves because stripDate of an undated id is itself",
        PRICING,
        "  push(bedrock);\n"
        "  push(stripDate(raw));\n"
        "  push(stripDate(noProvider));\n"
        "  push(stripDate(dashed));\n"
        "  push(stripDate(noTag));\n"
        "  push(stripDate(bedrock));\n",
        "  push(stripDate(raw));\n"
        "  push(stripDate(noProvider));\n"
        "  push(stripDate(dashed));\n"
        "  push(stripDate(noTag));\n",
    ),
    (
        "9. the DeepSeek Flash rows are reverted to the old $0.14/$0.28 tier, "
        "so V4.1-Flash disappears a second way and the aliases under-report",
        PRICING,
        '  "deepseek-v4.1-flash":          { input: 0.30, output: 1.20, cacheRead: 0.006, cacheWrite: 0.30 },\n',
        "",
    ),
    (
        "10. only the undated slug is added, so OpenRouter's dated snapshot "
        "`deepseek-v4.1-flash-1017` — the id DeepSeek says it actually serves "
        "— stays unpriced",
        PRICING,
        '  "deepseek-v4.1-flash-1017":     { input: 0.30, output: 1.20, cacheRead: 0.006, cacheWrite: 0.30 },\n',
        "",
    ),
    (
        "11. the Flash rate is entered at the OFF-PEAK figure ($0.15/$0.60), "
        "which is the vendor's other column — a plausible copy and a 2x "
        "under-report for any peak-hour workload",
        PRICING,
        '  "deepseek-v4.1-flash":          { input: 0.30, output: 1.20, cacheRead: 0.006, cacheWrite: 0.30 },',
        '  "deepseek-v4.1-flash":          { input: 0.15, output: 0.60, cacheRead: 0.003, cacheWrite: 0.15 },',
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
    green, tail = run_mobile()
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
        green, tail = run_mobile()
        restore()
        if green:
            failures.append(f"[BAD ] {label}: suite stayed GREEN — guard does not exist")
            print(f"[BAD ] {index:>2}. {label}: stayed GREEN")
        else:
            print(f"[OK]  {index:>2}. {label}: turned RED")
        _ = tail

    print("=" * 78)
    restore()
    green, tail = run_mobile()
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
