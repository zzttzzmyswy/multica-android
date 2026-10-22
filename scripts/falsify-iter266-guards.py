#!/usr/bin/env python3
"""Mutation-test iteration 266's two parity fixes (MYS-2300).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, `scripts/falsify-*.py`).

The two gaps this round closes, and what the mutations attack:

  #1  A run row stated its token count and nothing else. Web's row also says how
      long the run took, which model burned the tokens, and what they cost —
      the three facts that turn "8.2K tokens" into "was this run worth it". The
      arithmetic lives in `lib/run-row-meta.ts`; the failure modes are the ones
      that survive a unit test on the helper:
        - the row imports the helpers and draws only the token count (the
          pre-fix row, exactly);
        - the cost figure is computed without subscribing to the custom-rate
          store, so saving a rate never repaints it;
        - a run with no usage renders `$0.00` instead of an em dash, claiming a
          figure the client does not have;
        - the duration is measured from `created_at` (queue time) rather than
          `started_at`, blaming the agent for the queue;
        - the failure reason and the duration are both drawn, so the same
          sentence appears twice on the line;
        - the model id is narrowed to a truncation of our own instead of web's
          `shortModelName`, so two different models read identically.

  #2  A wakeup-triggered run was indistinguishable from a hand-started one. The
      judge must be `task.wakeup_id` and the rule must come from the issue's
      SHARED cache. The failure modes:
        - the label keeps quoting `trigger_summary`, which for a wakeup run is
          the rule's INSTRUCTION (reads as a task a person typed);
        - the judge becomes a string match on the summary, which breaks the
          moment a workspace changes language;
        - a missing rule (deleted, or still loading) renders a template with an
          empty condition — 「Wakeup · 」;
        - the rule lookup becomes a per-row request instead of narrowing the
          issue's cached list;
        - the label is wired into the runs list only, leaving the timeline's
          day list — the second place a run is listed — disagreeing.

Run: python3 scripts/falsify-iter266-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"

W = "app/(app)/[workspace]"

RUN_ROW = APP / "components" / "issue" / "run-row.tsx"
RUN_PANEL = APP / "components" / "issue" / "run-timeline-panel.tsx"
RUNS = APP / W / "issue" / "[id]" / "runs.tsx"
META = APP / "lib" / "run-row-meta.ts"
TRIGGER = APP / "lib" / "run-trigger-label.ts"
WAKEUP_QUERY = APP / "data" / "queries" / "run-wakeup.ts"
SHARED_TEXT = APP / "lib" / "use-wakeup-text.ts"

SUITE = [
    "lib/run-row-meta.test.ts",
    "lib/run-trigger-label.test.ts",
    "lib/iter266-wiring.test.ts",
]


def run_suite() -> tuple[bool, str]:
    """True when the suite is GREEN."""
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
    # ── #1 the row states duration / tokens / model / cost ─────────────────
    (
        "1. the row draws only the token count again — the helpers are all "
        "imported and tested, and the surface this round exists for is "
        "unchanged",
        RUN_ROW,
        '          <MetaText>{usage ? usage.tokens : "—"}</MetaText>\n'
        "          {usage?.model ? <MetaText>{usage.model}</MetaText> : null}\n"
        '          <MetaText>{usage ? usage.cost : "—"}</MetaText>\n',
        '          <MetaText>{usage ? usage.tokens : "—"}</MetaText>\n',
    ),
    (
        "2. the cost figure is priced without subscribing to the custom-rate "
        "store, so a rate saved on the runtime page never reaches the row",
        RUN_ROW,
        "  const pricings = useCustomPricingStore((s) => s.pricings);\n"
        "  const usage = useMemo(\n"
        "    () => runUsageParts(summarizeTaskUsage(task.usage)),\n",
        "  const usage = useMemo(\n"
        "    () => runUsageParts(summarizeTaskUsage(task.usage)),\n",
    ),
    (
        "3. a run with no usage renders $0.00 instead of an em dash — the "
        "client claims a figure it does not have",
        RUN_ROW,
        '          <MetaText>{usage ? usage.cost : "—"}</MetaText>\n',
        '          <MetaText>{usage ? usage.cost : "$0.00"}</MetaText>\n',
    ),
    (
        "4. the duration is measured from created_at (when the run was QUEUED) "
        "rather than started_at, so a busy runtime reads as a slow agent",
        META,
        "  if (!task.started_at || !task.completed_at) return null;\n"
        "  const started = new Date(task.started_at).getTime();\n",
        "  if (!task.completed_at) return null;\n"
        "  const started = new Date(task.created_at ?? task.started_at ?? 0).getTime();\n",
    ),
    (
        "5. the duration is stated even when a failure reason is, so the line "
        "says why the run stopped AND how long it took, in the same slot web "
        "fills with only one of them",
        RUN_ROW,
        "  const duration = reason ? null : runDurationLabel(task);\n",
        "  const duration = runDurationLabel(task);\n",
    ),
    (
        "6. the model id is shortened by a truncation of our own instead of "
        "web's rule, so two different models read identically ('claude-opus…')",
        META,
        "  const claude = id.match(/^claude-([a-z]+)((?:-\\d{1,2})+)(?:-(.+))?$/);\n",
        "  return id.slice(0, 12) + \"…\";\n"
        "  // eslint-disable-next-line no-unreachable\n"
        "  const claude = id.match(/^claude-([a-z]+)((?:-\\d{1,2})+)(?:-(.+))?$/);\n",
    ),
    (
        "7. the duration ignores an unparseable timestamp, so a NaN reaches "
        "the formatter and a broken row silently reads '0s' as if it were real",
        META,
        "  if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;\n",
        "",
    ),
    # ── #2 a wakeup run names its source ──────────────────────────────────
    (
        "8. the label keeps quoting trigger_summary — which for a wakeup run is "
        "the RULE'S INSTRUCTION, so the row reads as a task a person typed",
        TRIGGER,
        '  if (task.wakeup_id) return t("runs.triggeredByWakeup");\n',
        "",
    ),
    (
        "9. the judge becomes a string match on the summary instead of the "
        "field, so it breaks the moment the workspace language changes",
        TRIGGER,
        '  if (task.wakeup_id) return t("runs.triggeredByWakeup");\n',
        '  if (/wakeup|唤醒/i.test(task.trigger_summary ?? "")) return t("runs.triggeredByWakeup");\n',
    ),
    (
        "10. a missing rule renders the template anyway — 「Wakeup · 」, a "
        "sentence with its object missing, because runs outlive their rules",
        TRIGGER,
        "  if (!rule) return fallback;\n",
        "",
    ),
    (
        "11. the row stops consulting the rule and always shows the fallback, "
        "so the condition is never named even when the issue still has it",
        RUN_ROW,
        "  const summary = task.wakeup_id\n"
        "    ? wakeupRunLabel(text, rule, fallbackSummaryText)\n"
        "    : fallbackSummaryText;\n",
        "  const summary = fallbackSummaryText;\n",
    ),
    (
        "12. the rule lookup drops its enabled gate, so every ordinary run's "
        "row arms an issue-wide rule read it cannot use",
        WAKEUP_QUERY,
        "    enabled: !!wsId && !!issueId && !!wakeupId,\n",
        "",
    ),
    (
        "13. the rule lookup stops narrowing the issue's cached list and "
        "becomes a per-row request of its own — twenty rows, twenty reads",
        WAKEUP_QUERY,
        "  const { data } = useQuery({\n"
        "    ...issueWakeupsOptions(wsId, issueId ?? \"\"),\n",
        "  const { data } = useQuery({\n"
        "    ...issueWakeupsOptions(wsId, wakeupId ?? \"\"),\n",
    ),
    (
        "14. the timeline's day list — the SECOND place a run is listed — "
        "keeps quoting trigger_summary, so the two lists disagree about why a "
        "run exists",
        RUN_PANEL,
        "  const summary = task.wakeup_id\n"
        "    ? wakeupRunLabel(text, rule, fallbackSummary)\n"
        "    : fallbackSummary;\n",
        "  const summary = fallbackSummary;\n",
    ),
    (
        "15. the runs sheet stops threading the issue id into the timeline, so "
        "the day list's rows cannot resolve a rule at all",
        RUNS,
        "              <RunTimelinePanel timeline={timeline} unmapped={unmapped} issueId={id} />\n",
        "              <RunTimelinePanel timeline={timeline} unmapped={unmapped} issueId=\"\" />\n",
    ),
    (
        "16. the shared wakeup-text bundle drops its status resolver, so a "
        "condition naming a status prints the raw key `in_review` in the row "
        "and 'In Review' in the section above it",
        SHARED_TEXT,
        "      statusLabel,\n",
        "",
    ),
    (
        "17. the reason is re-derived from failure_reason in the row instead of "
        "the shared helper, so the badge and the duration gate can disagree "
        "about whether a reason is on screen",
        RUN_ROW,
        "  const reason = runReasonLabel(task, t);\n  // Web's rule, and its reason",
        "  const reason = task.failure_reason ?? null;\n  // Web's rule, and its reason",
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
