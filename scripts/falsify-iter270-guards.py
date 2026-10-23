#!/usr/bin/env python3
"""Mutation-test iteration 270's failure-taxonomy fix (MYS-2321).

Each mutation injects exactly ONE half-defect a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts GREEN again. A guard that cannot be made to fail is not a guard.

The gap this round closes, and why the previous gates missed it:

  Iteration 268 compared the rate TABLE to upstream's; iteration 269 replaced
  that with a *behavioural* gate on the pricing RESOLVER. Both were green, and
  both were looking at the wrong layer again: `AgentTask.failure_reason` was
  parsed through a six-member `z.enum`, so every refined reason the server
  actually writes (`agent_error.provider_quota_limit`, `cancelled`,
  `idle_watchdog`, …) was rewritten to `""` and then to `undefined`.

  The reason no existing test saw it: the schema's own tests only asserted the
  values the enum NAMED, and the label tests only asserted the labels the
  BUNDLE carried. Both sides were internally consistent — 26 labels, all
  reachable — while the join between them dropped 97% of live rows. So this
  round's guards have to compare the schema, the bundles, and upstream's
  vocabulary *against each other*, which is what
  `scripts/check-failure-taxonomy-parity.py` does.

The failure modes this gate attacks:

  - the enum comes back (the defect itself);
  - the enum is widened to a longer fixed list instead of an open string, so the
    next reason the server adds is dropped again;
  - the empty-string sentinel stops normalizing, so "not failed" rows look
    failed to every truthy check downstream;
  - a non-string value takes the row down with it instead of costing it a reason;
  - an unknown reason is hidden behind a generic "Failed" instead of degrading
    to its wire value the way web does;
  - `cancelled` / `user_cancelled` / `manual` stop counting as stops, so a
    stopped run renders as "Failed · Cancelled by the system";
  - a reason drifts from the action-required set, so a retry is invited for a
    run that will fail identically;
  - a bundle loses one of the labels the schema now lets through;
  - the actor label prints a name it does not have.

Run: python3 scripts/falsify-iter270-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
SCHEMA = APP / "data" / "schemas.ts"
OUTCOME = APP / "lib" / "task-outcome.ts"
ROW = APP / "components" / "issue" / "run-row.tsx"
EN = APP / "lib" / "i18n" / "locales" / "en.json"
ZH = APP / "lib" / "i18n" / "locales" / "zh.json"

SUITE = [
    "data/schemas-agent-task-failure-reason.test.ts",
    "lib/task-outcome.test.ts",
    "lib/run-row-outcome-wiring.test.ts",
    "lib/run-row-meta.test.ts",
    "lib/failure-class.test.ts",
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


OPEN_STRING = (
    "  failure_reason: z\n"
    "    .unknown()\n"
    '    .transform((v) => (typeof v === "string" && v !== "" ? v : undefined)),\n'
)

CANCEL_SET_ENTRY = '  "cancelled",\n  "manual",\n  "user_cancelled",\n'
ACTION_SET_ENTRY = '  "agent_error.provider_quota_limit",\n'

MUTATIONS: list[tuple[str, Path, str, str]] = [
    # ── the parse is open ─────────────────────────────────────────────────
    (
        "1. the six-member enum comes back — the exact defect, where every "
        "refined reason is rewritten to the empty sentinel",
        SCHEMA,
        OPEN_STRING,
        "  failure_reason: z\n"
        '    .enum(["agent_error", "timeout", "runtime_offline", '
        '"runtime_recovery", "manual", ""])\n'
        "    .optional()\n"
        '    .catch("")\n'
        '    .transform((v) => (v === "" ? undefined : v)),\n',
    ),
    (
        "2. the enum is merely WIDENED to a longer fixed list instead of "
        "opened, so the next reason the server adds is dropped again",
        SCHEMA,
        OPEN_STRING,
        "  failure_reason: z\n"
        '    .enum(["agent_error", "timeout", "runtime_offline", '
        '"runtime_recovery", "manual", "queued_expired", '
        '"agent_error.provider_quota_limit", ""])\n'
        "    .optional()\n"
        '    .catch("")\n'
        '    .transform((v) => (v === "" ? undefined : v)),\n',
    ),
    (
        "3. the empty-string sentinel stops normalizing, so a non-failed row "
        "carries a reason and every truthy check downstream misfires",
        SCHEMA,
        '    .transform((v) => (typeof v === "string" && v !== "" ? v : undefined)),\n',
        '    .transform((v) => (typeof v === "string" ? v : undefined)),\n',
    ),
    (
        "4. a non-string value takes the whole row down instead of costing it "
        "one reason (enum drift must downgrade, not crash)",
        SCHEMA,
        "    .unknown()\n"
        '    .transform((v) => (typeof v === "string" && v !== "" ? v : undefined)),\n',
        "    .unknown(),\n",
    ),
    # ── cancellation is a stop, not a breakage ────────────────────────────
    (
        "5. `cancelled` leaves the cancellation set, so a stopped run renders "
        "as 'Failed · Cancelled by the system'",
        OUTCOME,
        CANCEL_SET_ENTRY,
        '  "manual",\n  "user_cancelled",\n',
    ),
    (
        "6. the cancellation set empties entirely, so no failed row is ever "
        "classified as a stop",
        OUTCOME,
        CANCEL_SET_ENTRY,
        "",
    ),
    (
        "7. the status gate is dropped, so a COMPLETED row whose stale reason "
        "says 'cancelled' is painted as a cancellation",
        OUTCOME,
        '    task.status === "cancelled" ||\n'
        '    (task.status === "failed" &&\n'
        '      CANCELLATION_FAILURE_REASONS.has(task.failure_reason ?? ""))\n',
        '    task.status === "cancelled" ||\n'
        '    CANCELLATION_FAILURE_REASONS.has(task.failure_reason ?? "")\n',
    ),
    # ── action-required set ───────────────────────────────────────────────
    (
        "8. a quota failure leaves the action-required set, so the UI invites "
        "a retry that will fail identically",
        OUTCOME,
        ACTION_SET_ENTRY,
        "",
    ),
    (
        "9. the action-required set opens up to every failure, so a transient "
        "timeout is reported as needing a configuration change",
        OUTCOME,
        ACTION_SET_ENTRY,
        ACTION_SET_ENTRY + '  "timeout",\n  "runtime_offline",\n',
    ),
    # ── the label degrades honestly ───────────────────────────────────────
    (
        "10. an unknown reason is hidden behind a generic label instead of "
        "degrading to its wire value, which is what web does",
        OUTCOME,
        "    return localizedReason(task.failure_reason, t) ?? task.failure_reason;\n",
        "    return localizedReason(task.failure_reason, t);\n",
    ),
    (
        "11. the actor label prints a blank where a name should be, so an "
        "unresolved member reads 'Cancelled by '",
        OUTCOME,
        '  return name ? t("failureReason.cancelled_by_actor", { name }) : null;\n',
        '  return t("failureReason.cancelled_by_actor", { name: name ?? "" });\n',
    ),
    (
        "12. an unrecognised actor type is rendered as if it were a member",
        OUTCOME,
        '  if (type !== "member" && type !== "agent" && type !== "system") return null;\n',
        "",
    ),
    # ── the bundles carry the copy ────────────────────────────────────────
    (
        "13a. the en bundle loses the `cancelled` label the schema now lets "
        "through — the lookup that started this whole defect",
        EN,
        '  "failureReason.cancelled": "Cancelled by the system",\n',
        "",
    ),
    (
        "13b. the zh bundle loses the `idle_watchdog` label",
        ZH,
        '  "failureReason.idle_watchdog": "智能体长时间无活动，运行已停止",\n',
        "",
    ),
    (
        "13c. the en bundle loses a canonical agent_error label",
        EN,
        '  "failureReason.agent_error.provider_quota_limit": "Provider quota exhausted",\n',
        "",
    ),
    # ── the row actually calls the classifiers ────────────────────────────
    (
        "14. the row stops asking whether the run was stopped, so a "
        "cancellation renders as 'Failed · Cancelled by the system' again",
        ROW,
        "  if (isCancelledOutcome(task)) {\n",
        "  if (false) {\n",
    ),
    (
        "15. the action-required error is printed on every failed row instead "
        "of only the ones a retry cannot fix",
        ROW,
        "{failureNeedsAction(task) && task.error?.trim() ? (",
        "{task.error?.trim() ? (",
    ),
    (
        "16. the badge goes back to a lookup that returns null for an unknown "
        "reason, so a reason this build predates renders as a bare 'Failed'",
        ROW,
        "  const reason = runOutcomeLabel(task, t);\n  if (reason) {",
        "  const reason = task.failure_reason ?? null;\n  if (reason) {",
    ),
]


_snapshot: dict[Path, str] = {}


def restore() -> None:
    for path, text in _snapshot.items():
        path.write_text(text)


def main() -> int:
    for path in {m[1] for m in MUTATIONS}:
        _snapshot[path] = path.read_text()

    print("=" * 78)
    print("baseline")
    green, tail = run_suite()
    print(("GREEN" if green else "RED") + "  " + tail.replace("\n", " | "))
    if not green:
        print("baseline is not green — refusing to run mutations")
        return 1

    failures: list[str] = []
    for index, (label, path, needle, replacement) in enumerate(MUTATIONS, start=1):
        occurrences = path.read_text().count(needle)
        if occurrences != 1:
            failures.append(
                f"[MISS] {label}: needle appears {occurrences}x in {path.name} "
                "(expected exactly 1 — the mutation no longer targets live code)"
            )
            print(f"[MISS] {index:>2}. {label}: needle x{occurrences}")
            continue
        restore()
        path.write_text(path.read_text().replace(needle, replacement, 1))
        green, tail = run_suite()
        restore()
        if green:
            failures.append(
                f"[SURVIVED] {label}: suite stayed GREEN — this guard is false"
            )
            print(f"[SURVIVED] {index:>2}. {label}")
        else:
            print(f"[KILLED]   {index:>2}. {label}")

    print("=" * 78)
    green, tail = run_suite()
    print(("GREEN" if green else "RED") + "  restored baseline  " + tail.replace("\n", " | "))
    if not green:
        failures.append("restored baseline is not green")

    total = len(MUTATIONS)
    if failures:
        print(f"\n{len(failures)}/{total} mutation(s) did not behave:")
        for f in failures:
            print(f"  - {f}")
        return 1

    print(f"\nAll {total} mutations turned RED and restored GREEN.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
