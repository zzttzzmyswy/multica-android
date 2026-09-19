#!/usr/bin/env python3
"""Falsify iteration 158's guards: inject the defect the round fixes, confirm the
guard actually fails on it, then restore.

The 158 round closes two preprocessing gaps between the mobile client and web.

**Transcript preparation.** Web prepares every task-message stream with
`buildTimeline` (`packages/views/common/task-transcript/build-timeline.ts`):
merge the adjacent `thinking` / `text` fragments the daemon split by flush
timing, then mask secrets. Mobile rendered the raw stream. The fix moves that
logic into `@multica/core/task-transcript` (views now re-exports it, so there
is no mirror to drift) and adds the payload-shaped entry points the mobile
surfaces need:

  * `coalesceTaskMessages` / `redactTaskMessages` / `prepareTaskMessages` —
    `buildTimeline`'s two steps without the reshape into `TimelineItem`.
  * `apps/mobile/lib/task-log.ts:prepareTaskLog` — the run-log partition over a
    prepared stream.
  * four render sites route through them: `run-log.tsx`,
    `run-transcript-dialog.tsx`, `chat-message-list.tsx` (live + persisted),
    and `transcript-entry.tsx` masks the `input`-derived strings it renders.

**Timeline coalesce input range.** Web coalesces `topLevel` — activities plus
root comments (`issue-detail.tsx`) — and renders a reply nested under its
parent, so a reply never breaks a run of identical activities. Mobile
coalesced the flat array, so `[activity A, reply R, activity A]` stayed two
rows on the phone where web shows one row with a ×2 chip. `coalesceTimeline`
now compares against the previous *top-level* entry. Probe issue MYS-1271
reproduces the sequence end to end (root comment, status change, reply,
status change).

Two kinds of guard, and both are falsified here:

  * LOGIC — `packages/core/task-transcript/task-messages.test.ts`,
    `apps/mobile/lib/task-log.test.ts` and
    `apps/mobile/lib/timeline-coalesce.test.ts` assert the merge, the masking,
    and (the load-bearing one) that the payload path produces *exactly* what
    `buildTimeline` produces. Cases 1, 2 and 8 break each side of that parity
    independently, so the assertion cannot be satisfied by one path alone.
  * WIRING — `apps/mobile/lib/task-stream-prepare.test.ts` reads the component
    sources, because mobile vitest is Node-only (no RN renderer) and a correct
    pure function that no screen calls fixes nothing. That is the iter-157
    lesson: three test files each inlined a six-item `BOARD_STATUSES`, so the
    contract stayed green while the behaviour was wrong. Cases 4–7 revert the
    wiring and must redden it.

Green cases (must stay green — the guards are content-specific, not
churn-specific):

G1. A comment reworded in `packages/core/task-transcript/build-timeline.ts`
    leaves every guard green.
G2. A comment reworded in `components/issue/run-log.tsx` leaves every guard
    green — the wiring guard matches call syntax, not prose that quotes it.
G3. A comment reworded in `lib/timeline-coalesce.ts` leaves every guard green.

Run from the repo root: python3 scripts/falsify-iter158-guards.py
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "packages/core"
MOBILE = ROOT / "apps/mobile"

CORE_SUITES = ["task-transcript/task-messages.test.ts"]
MOBILE_SUITES = [
    "lib/task-log.test.ts",
    "lib/task-stream-prepare.test.ts",
    "lib/timeline-coalesce.test.ts",
]

CORE_TIMELINE = CORE / "task-transcript/build-timeline.ts"
CORE_REDACT = CORE / "task-transcript/redact.ts"
RUN_LOG = MOBILE / "components/issue/run-log.tsx"
RUN_TRANSCRIPT = MOBILE / "components/agent/run-transcript-dialog.tsx"
CHAT_LIST = MOBILE / "components/chat/chat-message-list.tsx"
TRANSCRIPT_ENTRY = MOBILE / "components/agent/transcript-entry.tsx"
TIMELINE_COALESCE = MOBILE / "lib/timeline-coalesce.ts"

# ── exact source fragments (unique in their file) ───────────────────────────

COALESCE_PAYLOAD = (
    "export function coalesceTaskMessages(msgs: TaskMessagePayload[]): TaskMessagePayload[] {\n"
    "  return mergeStreamingFragments(msgs);\n"
    "}\n"
)
COALESCE_PAYLOAD_NOOP = (
    "export function coalesceTaskMessages(msgs: TaskMessagePayload[]): TaskMessagePayload[] {\n"
    "  return msgs;\n"
    "}\n"
)

PREPARE = (
    "export function prepareTaskMessages(msgs: TaskMessagePayload[]): TaskMessagePayload[] {\n"
    "  return redactTaskMessages(coalesceTaskMessages(msgs));\n"
    "}\n"
)
PREPARE_NO_REDACT = (
    "export function prepareTaskMessages(msgs: TaskMessagePayload[]): TaskMessagePayload[] {\n"
    "  return coalesceTaskMessages(msgs);\n"
    "}\n"
)

COALESCE_TIMELINE = (
    "export function coalesceTimelineItems(items: TimelineItem[]): TimelineItem[] {\n"
    "  return mergeStreamingFragments(items);\n"
    "}\n"
)
COALESCE_TIMELINE_NOOP = (
    "export function coalesceTimelineItems(items: TimelineItem[]): TimelineItem[] {\n"
    "  return items;\n"
    "}\n"
)

AWS_PATTERN = (
    "  // AWS access key IDs\n"
    '  { re: /\\bAKIA[0-9A-Z]{16}\\b/g, replacement: "[REDACTED AWS KEY]" },\n'
)
AWS_PATTERN_GONE = ""

RUN_LOG_IMPORT = 'import { prepareTaskLog } from "@/lib/task-log";\n'
RUN_LOG_IMPORT_RAW = 'import { partitionTaskLog } from "@/lib/task-log";\n'
RUN_LOG_PREPARE = "useMemo(() => prepareTaskLog(data), [data]);\n"
RUN_LOG_RAW = "useMemo(() => partitionTaskLog(data), [data]);\n"

RUN_TRANSCRIPT_PREPARE = "const entries = useMemo(() => prepareTaskMessages(data), [data]);\n"
RUN_TRANSCRIPT_RAW = "const entries = useMemo(() => data, [data]);\n"

CHAT_LIVE_PREPARED = "<ChatTimeline items={liveTimeline} isStreaming />\n"
CHAT_LIVE_RAW = "<ChatTimeline items={liveTaskMessages ?? []} isStreaming />\n"

ENTRY_JSON_MASKED = (
    "    return <PlainBlock text={redactSecrets(JSON.stringify(entry.input, null, 2))} />;\n"
)
ENTRY_JSON_RAW = "    return <PlainBlock text={JSON.stringify(entry.input, null, 2)} />;\n"

COALESCE_PREV_TOP_LEVEL = (
    "      const prev = prevTopLevel >= 0 ? out[prevTopLevel] : undefined;\n"
)
COALESCE_PREV_IMMEDIATE = "      const prev = out[out.length - 1];\n"

COALESCE_COMMENT = " *   - Comments never coalesce (each is its own entry).\n"
COALESCE_COMMENT_NEW = " *   - Comments never coalesce; each is its own entry.\n"

CORE_COMMENT = " *  by daemon flush timing, ordered by `seq`. */\n"
CORE_COMMENT_NEW = " *  by daemon flush timing, then ordered by `seq`. */\n"
RUN_LOG_COMMENT = " * Loading / error / empty states are handled here so the caller only has to\n"
RUN_LOG_COMMENT_NEW = " * Loading / error / empty states live here so the caller only has to\n"

# ── real `it(...)` strings, character for character ─────────────────────────

C_MERGE_THINKING = "merges adjacent thinking fragments split by flush timing"
C_MERGE_ORDER = "orders out-of-order fragments by seq before merging"
C_REDACT_JOINED = "masks a secret that only becomes matchable once fragments are joined"
C_PARITY_EXACT = "produces exactly the timeline web's buildTimeline produces"
C_PARITY_COUNT = "agrees with buildTimeline on the step count a run reports"
C_REDACT_DIRECT = "masks secrets in content and output, leaving other fields alone"

M_ONE_STEP = "counts one process step per logical step, not per flush"
M_WEB_COUNT = "reports the same step count as web's buildTimeline"
M_MASK_NARRATION = "masks secrets in narration and tool output"
M_MASK_REASSEMBLED = "masks a secret reassembled from two flushes"

W_RUN_LOG = "prepares the run log and never partitions the raw stream"
W_DIALOG = "prepares the transcript dialog's entries and filters those, not the raw rows"
W_CHAT = "prepares both chat timelines — the live trace and the persisted one"
W_ENTRY = "masks every string the transcript row renders out of a payload"

T_REPLY_BETWEEN = "merges identical activities that a reply sits between"
T_REPLY_RUN = "keeps merging into the same row after a reply interrupts the run"

ALL_LOGIC = [
    C_MERGE_THINKING,
    C_MERGE_ORDER,
    C_REDACT_JOINED,
    C_PARITY_EXACT,
    C_PARITY_COUNT,
    M_ONE_STEP,
    M_WEB_COUNT,
    M_MASK_NARRATION,
    M_MASK_REASSEMBLED,
]

ALL_WIRING = [W_RUN_LOG, W_DIALOG, W_CHAT, W_ENTRY]

ALL_COALESCE = [T_REPLY_BETWEEN, T_REPLY_RUN]

# (label, [(file, old, new), ...], [tests that must fail], must contain, must not contain)
CASES = [
    (
        "1 the payload merge is a no-op (the round's own defect)",
        [(CORE_TIMELINE, COALESCE_PAYLOAD, COALESCE_PAYLOAD_NOOP)],
        [
            C_MERGE_THINKING,
            C_MERGE_ORDER,
            C_REDACT_JOINED,
            C_PARITY_EXACT,
            C_PARITY_COUNT,
            M_ONE_STEP,
            M_WEB_COUNT,
            M_MASK_REASSEMBLED,
        ],
        "to have a length of 2",
        None,
    ),
    (
        "2 prepareTaskMessages merges but skips redaction",
        [(CORE_TIMELINE, PREPARE, PREPARE_NO_REDACT)],
        [C_REDACT_JOINED, C_PARITY_EXACT, M_MASK_NARRATION, M_MASK_REASSEMBLED],
        "Authorization: Bearer [REDACTED]",
        None,
    ),
    (
        "3 the secret pattern list loses its AWS entry",
        [(CORE_REDACT, AWS_PATTERN, AWS_PATTERN_GONE)],
        [C_REDACT_DIRECT, M_MASK_NARRATION],
        "[REDACTED AWS KEY]",
        None,
    ),
    (
        "4 run-log.tsx renders the raw stream again",
        [
            (RUN_LOG, RUN_LOG_IMPORT, RUN_LOG_IMPORT_RAW),
            (RUN_LOG, RUN_LOG_PREPARE, RUN_LOG_RAW),
        ],
        [W_RUN_LOG],
        "expected +0 to be 1",
        None,
    ),
    (
        "5 the transcript dialog filters the raw rows again",
        [(RUN_TRANSCRIPT, RUN_TRANSCRIPT_PREPARE, RUN_TRANSCRIPT_RAW)],
        [W_DIALOG],
        "expected +0 to be 1",
        None,
    ),
    (
        "6 the live chat timeline renders raw while the prepared memo survives",
        [(CHAT_LIST, CHAT_LIVE_PREPARED, CHAT_LIVE_RAW)],
        [W_CHAT],
        "not to match",
        None,
    ),
    (
        "7 the transcript row renders tool_use input unmasked",
        [(TRANSCRIPT_ENTRY, ENTRY_JSON_MASKED, ENTRY_JSON_RAW)],
        [W_ENTRY],
        "expected 3 to be 4",
        None,
    ),
    (
        "8 the timeline coalesce compares against the immediately preceding row again",
        [(TIMELINE_COALESCE, COALESCE_PREV_TOP_LEVEL, COALESCE_PREV_IMMEDIATE)],
        ALL_COALESCE,
        "to deeply equal [ 'c0', 'a3', 'c2' ]",
        None,
    ),
    (
        "9 web's own coalescer is a no-op — parity must fail from the other side",
        [(CORE_TIMELINE, COALESCE_TIMELINE, COALESCE_TIMELINE_NOOP)],
        [C_PARITY_EXACT, C_PARITY_COUNT],
        "to have a length of 3",
        None,
    ),
]

GREEN_CASES = [
    (
        "G1 a comment reworded in core build-timeline.ts leaves every guard alone",
        [(CORE_TIMELINE, CORE_COMMENT, CORE_COMMENT_NEW)],
        ALL_LOGIC + ALL_WIRING,
    ),
    (
        "G2 a comment reworded in run-log.tsx leaves every guard alone",
        [(RUN_LOG, RUN_LOG_COMMENT, RUN_LOG_COMMENT_NEW)],
        ALL_LOGIC + ALL_WIRING + ALL_COALESCE,
    ),
    (
        "G3 a comment reworded in timeline-coalesce.ts leaves every guard alone",
        [(TIMELINE_COALESCE, COALESCE_COMMENT, COALESCE_COMMENT_NEW)],
        ALL_LOGIC + ALL_WIRING + ALL_COALESCE,
    ),
]


def vitest(cwd: Path, suites) -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", *suites, "--reporter=verbose"],
        cwd=cwd, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def all_output() -> str:
    return vitest(CORE, CORE_SUITES) + vitest(MOBILE, MOBILE_SUITES)


def red(out: str, name: str) -> bool:
    return any(name in line and ("×" in line or "✗" in line) for line in out.splitlines())


def inject(injections):
    """Apply every injection, then hand back one original per file.

    Read each file once and write it once: recording an original per injection
    would leave a file with several injections half-restored, since the last
    write wins and it already carries the earlier ones.
    """
    by_file = {}
    for path, old, new in injections:
        src = by_file.get(path)
        if src is None:
            src = path.read_text(encoding="utf-8")
        if src.count(old) != 1:
            raise ValueError(f"anchor not unique in {path.name} ({src.count(old)}): {old!r}")
        by_file[path] = src.replace(old, new, 1)

    originals = []
    for path, _, _ in injections:
        if path in by_file:
            originals.append((path, path.read_text(encoding="utf-8")))
            path.write_text(by_file.pop(path), encoding="utf-8")
    return originals


def restore(originals):
    for path, src in originals:
        path.write_text(src, encoding="utf-8")


failures = []

for label, injections, must_fail, must_contain, must_not_contain in CASES:
    try:
        originals = inject(injections)
    except ValueError as error:
        failures.append(f"{label}: {error}")
        print(f"MISS {label} ({error})")
        continue
    try:
        out = all_output()
    finally:
        restore(originals)

    stayed_green = [name for name in must_fail if not red(out, name)]
    if stayed_green:
        failures.append(f"{label}: guard stayed green (looked for {stayed_green!r})")
        print(f"MISS {label}")
        continue
    if must_contain and must_contain not in out:
        failures.append(f"{label}: failure did not carry {must_contain!r}")
        print(f"MISS {label} (message absent)")
        continue
    if must_not_contain and must_not_contain in out:
        failures.append(f"{label}: failure still carried {must_not_contain!r}")
        print(f"MISS {label} (wrong message present)")
        continue
    print(f"OK   {label}")

for label, injections, must_stay_green in GREEN_CASES:
    try:
        originals = inject(injections)
    except ValueError as error:
        failures.append(f"{label}: {error}")
        print(f"MISS {label} ({error})")
        continue
    try:
        out = all_output()
    finally:
        restore(originals)

    went_red = [name for name in must_stay_green if red(out, name)]
    if went_red:
        failures.append(f"{label}: false positive — {went_red!r} went red")
        print(f"FAIL {label}")
        continue
    print(f"OK   {label}")

print("\n-- restored state --")
for cwd, suites in ((CORE, CORE_SUITES), (MOBILE, MOBILE_SUITES)):
    out = vitest(cwd, suites)
    ok = " failed" not in out.split("Test Files")[-1]
    print(f"{'OK  ' if ok else 'FAIL'} {' + '.join(suites)}")
    if not ok:
        failures.append(f"guarded suites did not return to green: {suites}")

for cwd in (CORE, MOBILE):
    result = subprocess.run(
        ["npx", "tsc", "--noEmit"], cwd=cwd, capture_output=True, text=True,
    )
    ok = "error TS" not in result.stdout + result.stderr
    print(f"{'OK  ' if ok else 'FAIL'} {cwd.name} tsc --noEmit")
    if not ok:
        failures.append(f"{cwd.name} tsc not clean after restore")

print()
if failures:
    print(f"FAILED ({len(failures)}):")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)
print("all injections caught, all boundary cases green, workspace restored.")
