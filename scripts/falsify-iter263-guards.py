#!/usr/bin/env python3
"""Mutation-test iteration 263's three fixes (MYS-2273).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, scripts/falsify-*.py).

The three gaps this round closes, and what the mutations attack:

  #1  OpenClaw routing config had no mobile surface at all. The screen now reads
      and writes `agent.runtime_config`, gated on the bound runtime's provider.
      The dangerous half is the token: the API substitutes a mask sentinel
      ("***") for every stored token on read and treats the same sentinel on
      write as "keep the persisted value". Mutations: put the sentinel in the
      input, forget to replay it on submit, keep replaying it after a keystroke,
      keep replaying it across a mode round trip, accept a non-numeric port,
      treat "read not arrived" as "not an OpenClaw agent", save off an unread
      record, and drop TLS out of the payload.

  #2  The select / multi_select property pickers rendered every option with no
      search, so a definition with ten-plus options meant blind-scrolling a
      sheet that shows five rows. Mutations: show the field at the threshold
      instead of past it, compute the match and render the raw list anyway,
      blank the sheet instead of saying nothing matched, treat a whitespace-only
      query as a real one, and match against the option id.

  #3  The filter chip bar had Clear but no Save, so keeping a set of filters
      meant scrolling back up to the saved-views bar. Mutations: drop the
      control, hardcode one label instead of the three-way rule, open create
      unconditionally (filing a duplicate instead of editing), label a
      non-owner's button "Edit", wire only the workspace surface, and leave the
      raised request with no consumer.

Run: python3 scripts/falsify-iter263-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"

W = "app/(app)/[workspace]"

ROUTING_LIB = APP / "lib" / "openclaw-routing.ts"
ROUTING_AVAIL = APP / "lib" / "openclaw-routing-availability.ts"
ROUTING_ROUTE = APP / W / "more" / "agents" / "[id]" / "routing.tsx"
AGENT_DETAIL = APP / W / "more" / "agents" / "[id].tsx"
AGENT_ACTIONS = APP / "components" / "agent" / "agent-detail-actions.tsx"
WORKSPACE_LAYOUT = APP / W / "_layout.tsx"

OPTION_SEARCH = APP / "lib" / "property-option-search.ts"
PROPERTY_BODY = APP / "components" / "issue" / "pickers" / "property-value-body.tsx"

CHIP_SAVE = APP / "lib" / "chip-save-view.ts"
CHIP_HINT = APP / "lib" / "use-chip-save-hint.ts"
CHROME = APP / "components" / "issue" / "issue-surface-chrome.tsx"
VIEW_BAR = APP / "components" / "issue" / "issue-view-bar.tsx"
ISSUES = APP / W / "more" / "issues.tsx"
MY_ISSUES = APP / W / "(tabs)" / "my-issues.tsx"
PROJECT_SURFACE = APP / "components" / "project" / "project-issue-surface.tsx"

SUITE = [
    "lib/openclaw-routing.test.ts",
    "lib/openclaw-routing-availability.test.ts",
    "lib/property-option-search.test.ts",
    "lib/chip-save-view.test.ts",
    "data/stores/save-view-request-store.test.ts",
    "lib/iter263-wiring.test.ts",
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
    # ── #1 OpenClaw routing config ──────────────────────────────────────────
    (
        "1. the mask sentinel is rendered into the token input instead of an "
        "empty field, inviting the user to 'fix' it by hand into a token the "
        "gateway rejects",
        ROUTING_LIB,
        "    token: masked ? \"\" : (cfg.gateway?.token ?? \"\"),",
        "    token: cfg.gateway?.token ?? \"\",",
    ),
    (
        "2. an untouched saved token is NOT replayed on submit, so saving any "
        "other field silently clears the stored gateway token",
        ROUTING_LIB,
        "  if (state.tokenWasMasked && state.token === \"\") {\n"
        "    // Untouched saved token: replay the sentinel so the server keeps it. The\n"
        "    // value also has to sit on the TYPED object, or the equality check below\n"
        "    // would report the form as dirty against a config that never changed.\n"
        "    gw.token = OPENCLAW_GATEWAY_TOKEN_MASK;\n"
        "  } else if (state.token !== \"\") {",
        "  if (false) {\n"
        "    gw.token = OPENCLAW_GATEWAY_TOKEN_MASK;\n"
        "  } else if (state.token !== \"\") {",
    ),
    (
        "3. a token keystroke does not drop the masked flag, so emptying the "
        "field preserves the token the user meant to clear",
        ROUTING_ROUTE,
        "patch({ token, tokenWasMasked: false })",
        "patch({ token })",
    ),
    (
        "4. switching routing mode keeps the masked flag, so gateway → local → "
        "gateway silently restores a token the user meant to drop",
        ROUTING_ROUTE,
        "patch({ mode, tokenWasMasked: false })",
        "patch({ mode })",
    ),
    (
        "5. the port accepts anything non-empty, so '80a' and '-1' disable "
        "nothing and are truncated into a port the user never typed",
        ROUTING_LIB,
        '  return port === "" || /^\\d+$/.test(port);',
        '  return port === "" || port.length > 0;',
    ),
    (
        "6. an unsettled runtime read is resolved as 'not an OpenClaw agent', "
        "withdrawing a surface the user is entitled to and saying nothing why",
        ROUTING_AVAIL,
        '  if (!runtimesSettled) return { state: "pending" };',
        '  if (!runtimesSettled) return { state: "hidden", reason: "other-provider" };',
    ),
    (
        "7. a FAILED runtime read is resolved as hidden rather than retryable, "
        "so the user is told a false thing about their provider",
        ROUTING_AVAIL,
        '  if (runtimesFailed) return { state: "failed" };',
        '  if (runtimesFailed) return { state: "hidden", reason: "other-provider" };',
    ),
    (
        "8. save is allowed off an unread agent row, writing a config derived "
        "from nothing over whatever the server actually holds",
        ROUTING_LIB,
        "  return dirty && portValid && readSettled && !saving;",
        "  return dirty && portValid && !saving;",
    ),
    (
        "9. TLS is dropped from the payload, so turning it on writes a config "
        "that still dials http://",
        ROUTING_LIB,
        "  if (state.tls) gw.tls = true;",
        "  if (state.tls) gw.tls = false;",
    ),
    (
        "10. local mode keeps a stale endpoint block instead of collapsing it, "
        "so 'Local' submits gateway pins it claims not to use",
        ROUTING_LIB,
        '  if (state.mode !== "gateway") return cfg;',
        '  if (state.mode !== "gateway" && Object.keys(state).length === 0) return cfg;',
    ),
    (
        "11. the routing screen is reachable from nowhere — the route exists "
        "but no menu entry pushes it",
        AGENT_ACTIONS,
        '    if (showRouting) push(t("agents.detail.menu.routing"), "routing");',
        "",
    ),
    (
        "12. the menu entry is offered for every agent, including ones whose "
        "runtime is not OpenClaw, so it opens a screen that says 'not applicable'",
        AGENT_DETAIL,
        '  const showRouting = routingAvailability?.state === "shown";',
        "  const showRouting = true;",
    ),
    (
        "13. the pushed route is not registered in the layout, so the menu "
        "entry lands on the router's not-found face on device",
        WORKSPACE_LAYOUT,
        '          name="more/agents/[id]/routing"',
        '          name="more/agents/[id]/routing-unregistered"',
    ),
    (
        "14. the form posts its own state instead of the serialized config, "
        "writing the port as a string and leaking the UI flag onto the wire",
        ROUTING_ROUTE,
        "        runtime_config: serializeOpenclawRuntimeConfig(cfg),",
        "        runtime_config: form as unknown as Record<string, unknown>,",
    ),
    (
        "14b. the typed config is posted straight through, so an empty gateway "
        "block reaches the wire and a partial pin stops being partial",
        ROUTING_ROUTE,
        "        runtime_config: serializeOpenclawRuntimeConfig(cfg),",
        "        runtime_config: cfg as Record<string, unknown>,",
    ),
    (
        "14c. the form reseeds from its own draft instead of the server's "
        "response, leaving the field showing a token the server has already masked",
        ROUTING_ROUTE,
        "      setState(routingConfigToForm(parseOpenclawRuntimeConfig(resp.runtime_config)));",
        "      setState(routingConfigToForm(cfg));",
    ),

    # ── #2 option search ────────────────────────────────────────────────────
    (
        "15. the search field appears AT the threshold rather than past it, so "
        "a seven-option list grows a row of noise web does not show",
        OPTION_SEARCH,
        "  return propertyOptions(property).length > PROPERTY_OPTION_SEARCH_THRESHOLD;",
        "  return propertyOptions(property).length >= PROPERTY_OPTION_SEARCH_THRESHOLD;",
    ),
    (
        "16. the match is computed but the raw option list is rendered anyway, "
        "so the search box changes nothing on screen",
        PROPERTY_BODY,
        "          data={matched}",
        "          data={propertyOptions(property)}",
    ),
    (
        "17. the search field is never rendered, so the query can only ever be "
        "empty and the whole feature is dead code",
        PROPERTY_BODY,
        "        {searchable ? (",
        "        {false ? (",
    ),
    (
        "18. a query matching nothing leaves a blank sheet instead of saying "
        "so — which reads as 'this property has no options'",
        PROPERTY_BODY,
        "            hasNoPropertyOptionMatch(matched.length) ? (",
        "            false ? (",
    ),
    (
        "19. a whitespace-only query is treated as a real query, blanking the "
        "picker when the keyboard leaves a stray space",
        OPTION_SEARCH,
        "  return options.filter((option) => matchesNameOrPinyin(option.name, query));",
        "  return options.filter((option) => option.name.toLowerCase().includes(query));",
    ),
    (
        "20. the option id is matched as well as the name, surfacing rows whose "
        "visible text has nothing to do with what was typed",
        OPTION_SEARCH,
        "  return options.filter((option) => matchesNameOrPinyin(option.name, query));",
        "  return options.filter((option) =>\n"
        "    matchesNameOrPinyin(option.name, query) || option.id.includes(query),\n"
        "  );",
    ),

    # ── #3 chip-bar save shortcut ───────────────────────────────────────────
    (
        "21. the shortcut is never rendered, so the label and the request "
        "channel are both dead code",
        CHROME,
        "        {onSave ? (",
        "        {false ? (",
    ),
    (
        "22. the label collapses to one word, telling a non-owner their tap "
        "edits a view it would actually clone",
        CHIP_SAVE,
        '  return canManage ? "edit" : "save-as";',
        '  return "edit";',
    ),
    (
        "23. the dialog always opens in create mode, filing a near-duplicate "
        "every time a view owner tries to keep an edit",
        VIEW_BAR,
        "    if (activeView && canManage(activeView)) {\n"
        "      setDialog({ mode: \"edit\", view: activeView });\n"
        "      return;\n"
        "    }\n"
        "    setDialog({ mode: \"create\" });",
        "    setDialog({ mode: \"create\" });",
    ),
    (
        "24. the raised request has no consumer, so the shortcut renders and "
        "does nothing when tapped",
        VIEW_BAR,
        "    openSaveDialog();\n  }, [saveRequestToken, openSaveDialog]);",
        "  }, [saveRequestToken, openSaveDialog]);",
    ),
    (
        "25. only the workspace Issues surface wires the shortcut, leaving My "
        "Issues and the project surface with a control that never appears",
        MY_ISSUES,
        "          onSave={chipSave.visible ? chipSave.onPress : undefined}",
        "          onSave={undefined}",
    ),
    (
        "26. the project surface passes another container's scope, so the label "
        "and the dialog both follow the wrong open view",
        PROJECT_SURFACE,
        "  const chipSave = useChipSaveHint(projectScope);",
        "  const chipSave = useChipSaveHint({ scope_type: \"my\" });",
    ),
    (
        "27. the shortcut is offered before the view list has arrived, so the "
        "open view cannot resolve and an 'Edit' tap files a duplicate",
        CHIP_SAVE,
        "  return viewsSettled;",
        "  return true;",
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
