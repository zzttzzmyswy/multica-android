#!/usr/bin/env python3
"""Falsify iteration 161's guards: inject the defect each guard claims to catch,
confirm the guard actually fails on it, then restore.

The 161 round closes a product-parity gap in the chat surface.

**What web had and mobile did not.** When a chat session is bound to an agent
that has since been archived, web keeps the session honest
(`packages/views/chat/components/chat-window.tsx`): it resolves the session's
agent from the **archived-inclusive** agent list, renders `ArchivedAgentBanner`
("{{name}} has been archived — this conversation is read-only.") in a slot
whose precedence is no-agent > archived > runtime-required > offline, disables
the composer, and refuses to send. Mobile resolved the session's agent from the
archived-free list, so `currentAgent` came back null: the header degraded to
the generic "Chat", the composer said "No agent selected", and the reason the
conversation was dead was nowhere on screen. The session-history row lost the
agent's name and avatar the same way.

**How it is built.** `apps/mobile/lib/chat-session-agent.ts` owns the two
decisions (`resolveSessionAgent`, `isAgentArchived`); the chat screen, the
session-history list and the shared actor lookup all read the archived-inclusive
query; a new `ArchivedAgentBanner` occupies web's slot.

Two kinds of guard, both falsified here:

  * LOGIC — `apps/mobile/lib/chat-session-agent.test.ts` pins resolution
    (an archived agent must resolve, an unknown id must not fall back to some
    other agent) and the archived predicate (a missing agent is NOT archived —
    that is what routes the banner slot to its other branches).
  * WIRING — `apps/mobile/lib/archived-agent-chat-wiring.test.ts` reads the
    screen source, because mobile vitest is Node-only (no RN renderer) and a
    correct pure helper that no screen calls fixes nothing.

Case 5 and case 6 both concern the session-agent resolution but redden
different tests: reverting to a bare `find` breaks both the helper assertion
and the no-bare-find assertion, while swapping only the query leaves the
resolution call intact. Cases 7 and 8 likewise separate: deleting the banner
block kills the render and precedence assertions, while hardwiring its gate
kills only the gate assertion.

Green cases (must stay green — the guards are content-specific, not
churn-specific):

G1. A comment reworded in `lib/chat-session-agent.ts` leaves every guard alone.
G2. A comment in the chat screen that QUOTES the gate call verbatim leaves
    every guard alone — the wiring guard strips comments before matching, so
    prose can neither satisfy nor break it.
G3. A comment in the chat screen that quotes a bare `agents.find((a) => a.id
    === ...` leaves the "no bare find" guard alone — otherwise a note
    explaining WHY the list resolution is used would trip the guard it
    documents.

Run from the repo root: python3 scripts/falsify-iter161-guards.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps/mobile"

MOBILE_SUITES = [
    "lib/chat-session-agent.test.ts",
    "lib/archived-agent-chat-wiring.test.ts",
]

SESSION_AGENT = MOBILE / "lib/chat-session-agent.ts"
CHAT = MOBILE / "app/(app)/[workspace]/(tabs)/chat.tsx"
SESSIONS = MOBILE / "app/(app)/[workspace]/chat-sessions.tsx"

# ── exact source fragments (unique in their file) ───────────────────────────

RESOLVE_BODY = "  return agents.find((a) => a.id === agentId) ?? null;\n"
MISSING_ID_GUARD = "  if (!agentId) return null;\n"
MISSING_ID_GUARD_GONE = ""
# The round's own defect: resolve from the *available* list, i.e. drop retired
# agents — exactly what made the session lose its identity.
RESOLVE_DROPS_ARCHIVED = (
    "  return agents.find((a) => a.id === agentId && !a.archived_at) ?? null;\n"
)
# The wrong-agent hazard web's comment warns about: an unknown id falls back to
# some other agent instead of resolving to nothing.
RESOLVE_FALLS_BACK = (
    "  return agents.find((a) => a.id === agentId) ?? agents[0] ?? null;\n"
)

ARCHIVED_BODY = "  return Boolean(agent?.archived_at);\n"
ARCHIVED_INVERTED = "  return !agent?.archived_at;\n"
# Field drift: the authoritative flag is `archived_at`, not a boolean mirror.
ARCHIVED_WRONG_FIELD = (
    "  return Boolean((agent as { archived?: boolean })?.archived);\n"
)

RESOLVE_CALL = (
    "      return resolveSessionAgent(agents, activeSession.agent_id);\n"
)
RESOLVE_CALL_REVERTED = (
    "      return agents.find((a) => a.id === activeSession.agent_id) ?? null;\n"
)

QUERY = "agentListAllOptions(wsId)"
QUERY_REVERTED = "agentListOptions(wsId)"

BANNER_BLOCK = (
    '        {availability === "none" ? null : sessionAgentArchived ? (\n'
    "          <ArchivedAgentBanner agentName={currentAgent?.name} />\n"
    "        ) : runtimeBound ? (\n"
)
BANNER_BLOCK_GONE = '        {availability === "none" ? null : runtimeBound ? (\n'
BANNER_BLOCK_HARDWIRED = (
    '        {availability === "none" ? null : true ? (\n'
    "          <ArchivedAgentBanner agentName={currentAgent?.name} />\n"
    "        ) : runtimeBound ? (\n"
)

REASON_BLOCK = (
    "        : sessionAgentArchived\n"
    '          ? t("chat.agentArchived")\n'
)
REASON_BLOCK_GONE = ""

SEND_GUARD = "      if (sessionAgentArchived) return;\n"
SEND_GUARD_GONE = ""

SESSION_AGENT_COMMENT = " * conversation read-only history. Mobile mirrors both halves here.\n"
SESSION_AGENT_COMMENT_NEW = " * conversation read-only history. Mobile mirrors the same two halves.\n"

CHAT_GATE_COMMENT = "  // Retired agent: the conversation is read-only history.\n"
CHAT_GATE_COMMENT_NEW = (
    "  // Retired agent: the conversation is read-only history. The banner slot\n"
    "  // gates on:\n"
    '  //   {availability === "none" ? null : sessionAgentArchived ? (\n'
)

CHAT_FIND_COMMENT = (
    "  // Active agent: explicit selection wins; otherwise inherit from the\n"
)
CHAT_FIND_COMMENT_NEW = (
    "  // Active agent: explicit selection wins; otherwise inherit from the\n"
    "  // session — resolved from the archived-inclusive list, NOT via a bare\n"
    "  //   agents.find((a) => a.id === activeSession.agent_id)\n"
    "  // which would drop a retired agent and blank the session.\n"
)

# ── real `it(...)` strings, character for character ─────────────────────────

# logic — resolveSessionAgent
L_LIVE = "resolves a live agent"
L_ARCHIVED = "resolves an archived agent — the whole point of the archived-inclusive list"
L_UNKNOWN = "returns null for an id that is in neither list"
L_MISSING_ID = "returns null for a missing / null / empty agent id"
L_EMPTY_LIST = "returns null on an empty list rather than throwing"

# logic — isAgentArchived
L_NOT_ARCHIVED = "is false for a live agent"
L_IS_ARCHIVED = "is true for an archived agent"
L_NO_AGENT = "is false for a null / undefined agent — no session agent is not 'archived'"
L_EMPTY_STAMP = "treats an empty-string archived_at as live"

# wiring
W_HELPER = "resolves the session's agent through the shared helper"
W_NO_BARE_FIND = "does not resolve the session's agent with a bare list find"
W_QUERY = "reads the archived-inclusive agent query, not the archived-free one"
W_PREDICATE = "derives archived-ness from the shared predicate"
W_RENDERS = "renders the archived banner, gated on that predicate"
W_PRECEDENCE = "puts the archived banner ahead of the runtime and presence banners"
W_REASON = "disables the composer with the archived reason"
W_SEND_GUARD = "refuses to send into an archived conversation"
W_SESSIONS = "resolves session-list rows from the archived-inclusive list too"

ALL_LOGIC = [
    L_LIVE, L_ARCHIVED, L_UNKNOWN, L_MISSING_ID, L_EMPTY_LIST,
    L_NOT_ARCHIVED, L_IS_ARCHIVED, L_NO_AGENT, L_EMPTY_STAMP,
]
ALL_WIRING = [
    W_HELPER, W_NO_BARE_FIND, W_QUERY, W_PREDICATE, W_RENDERS,
    W_PRECEDENCE, W_REASON, W_SEND_GUARD, W_SESSIONS,
]
ALL_GUARDS = ALL_LOGIC + ALL_WIRING

# (label, [(file, old, new), ...], [tests that must fail], must contain)
CASES = [
    (
        "1 resolution drops archived agents (the round's own defect)",
        [(SESSION_AGENT, RESOLVE_BODY, RESOLVE_DROPS_ARCHIVED)],
        [L_ARCHIVED],
        "expected null to be",
    ),
    (
        "2 an unknown agent id falls back to some other agent",
        [(SESSION_AGENT, RESOLVE_BODY, RESOLVE_FALLS_BACK)],
        # Only the unknown-id case: the `if (!agentId) return null;` early
        # return still guards the missing-id path, so that assertion stays
        # green under this defect — deliberately, and pinned by case 2b below.
        [L_UNKNOWN],
        "expected",
    ),
    (
        "2b the missing-agent-id early return is dropped, with a fallback in place",
        [
            (SESSION_AGENT, RESOLVE_BODY, RESOLVE_FALLS_BACK),
            (SESSION_AGENT, MISSING_ID_GUARD, MISSING_ID_GUARD_GONE),
        ],
        # Dropping the early return on its own changes nothing (a `find` for a
        # falsy id already misses), so the case pairs it with the fallback —
        # that combination is what makes the missing-id assertion load-bearing.
        [L_UNKNOWN, L_MISSING_ID],
        "expected",
    ),
    (
        "3 the archived predicate inverts",
        [(SESSION_AGENT, ARCHIVED_BODY, ARCHIVED_INVERTED)],
        [L_NOT_ARCHIVED, L_IS_ARCHIVED, L_NO_AGENT],
        "expected",
    ),
    (
        "4 the archived predicate reads a boolean mirror instead of archived_at",
        [(SESSION_AGENT, ARCHIVED_BODY, ARCHIVED_WRONG_FIELD)],
        [L_IS_ARCHIVED],
        "expected false to be true",
    ),
    (
        "5 the screen resolves the session's agent with a bare list find",
        [(CHAT, RESOLVE_CALL, RESOLVE_CALL_REVERTED)],
        [W_HELPER, W_NO_BARE_FIND],
        "resolveSessionAgent",
    ),
    (
        "6 the screen reads the archived-free agent query",
        [(CHAT, QUERY, QUERY_REVERTED)],
        [W_QUERY],
        "agentListAllOptions",
    ),
    (
        "7 the screen stops rendering the archived banner",
        [(CHAT, BANNER_BLOCK, BANNER_BLOCK_GONE)],
        [W_RENDERS, W_PRECEDENCE],
        "ArchivedAgentBanner",
    ),
    (
        "8 the banner is hardwired on instead of gated on the predicate",
        [(CHAT, BANNER_BLOCK, BANNER_BLOCK_HARDWIRED)],
        [W_RENDERS],
        "sessionAgentArchived",
    ),
    (
        "9 the composer loses its archived reason",
        [(CHAT, REASON_BLOCK, REASON_BLOCK_GONE)],
        [W_REASON],
        # Vitest truncates the received string, so match the regex literal's
        # head — the tail (`chat.agentArchived`) is cut off with an ellipsis.
        "to match /sessionAgentArchived",
    ),
    (
        "10 the send guard is dropped",
        [(CHAT, SEND_GUARD, SEND_GUARD_GONE)],
        [W_SEND_GUARD],
        "sessionAgentArchived",
    ),
    (
        "11 the session-history list reads the archived-free agent query",
        [(SESSIONS, QUERY, QUERY_REVERTED)],
        [W_SESSIONS],
        "agentListAllOptions",
    ),
]

GREEN_CASES = [
    (
        "G1 a comment reworded in chat-session-agent.ts leaves every guard alone",
        [(SESSION_AGENT, SESSION_AGENT_COMMENT, SESSION_AGENT_COMMENT_NEW)],
        ALL_GUARDS,
    ),
    (
        "G2 a comment QUOTING the banner gate leaves every guard alone",
        [(CHAT, CHAT_GATE_COMMENT, CHAT_GATE_COMMENT_NEW)],
        ALL_GUARDS,
    ),
    (
        "G3 a comment quoting a bare agents.find leaves the no-bare-find guard alone",
        [(CHAT, CHAT_FIND_COMMENT, CHAT_FIND_COMMENT_NEW)],
        ALL_GUARDS,
    ),
]


def vitest(suites) -> str:
    result = subprocess.run(
        ["npx", "vitest", "run", *suites, "--reporter=verbose"],
        cwd=MOBILE, capture_output=True, text=True,
    )
    return result.stdout + result.stderr


def all_output() -> str:
    return vitest(MOBILE_SUITES)


def red(out: str, name: str) -> bool:
    return any(name in line and ("×" in line or "✗" in line) for line in out.splitlines())


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def suites_green(out: str) -> bool:
    """Read the runner's own summary line, not the raw text.

    Substring-scanning the whole output for " failed" is wrong here: these
    guards read component sources, and a failing assertion prints the whole
    file body, which can contain the word "failed" in the injected text. Parse
    `Test Files  N passed (N)` instead.
    """
    summary = re.search(r"^ +Test Files .*$", ANSI.sub("", out), re.M)
    return summary is not None and " failed" not in summary.group(0)


def inject(injections):
    """Apply every injection, then hand back one original per file.

    Read each file once and write it once: recording an original per injection
    would leave a file with several injections half-restored, since the last
    write wins and it already carries the earlier ones (the 158 defect).
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


# Snapshot before the first injection. Comparing against git HEAD would flag
# the round's own uncommitted work as a failed restore.
PRISTINE = {
    path: path.read_text(encoding="utf-8")
    for path in (SESSION_AGENT, CHAT, SESSIONS)
}


failures = []

for label, injections, must_fail, must_contain in CASES:
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
    if must_contain and must_contain not in ANSI.sub("", out):
        failures.append(f"{label}: failure did not carry {must_contain!r}")
        print(f"MISS {label} (message absent)")
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
out = vitest(MOBILE_SUITES)
ok = suites_green(out)
print(f"{'OK  ' if ok else 'FAIL'} {' + '.join(MOBILE_SUITES)}")
if not ok:
    for line in ANSI.sub("", out).splitlines():
        if "×" in line or "FAIL " in line or "Test Files" in line:
            print(f"      {line.strip()}")
    failures.append(f"guarded suites did not return to green: {MOBILE_SUITES}")

for path, before in PRISTINE.items():
    if path.read_text(encoding="utf-8") != before:
        failures.append(f"{path} left modified after restore")

if failures:
    print("\nFAILURES:")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)

print("\nall iter161 guards falsified")
