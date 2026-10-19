#!/usr/bin/env python3
"""Mutation-test iteration 258's three fixes (MYS-2236).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, and asserts the suite turns RED; the
restore is then asserted GREEN. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, scripts/falsify-*.py).

The three defects this round fixes, and what the mutations attack:

  #1  "Delete from workspace" on a custom runtime deleted the RUNTIME
      INSTANCE and left the profile registration behind. The label was right;
      the endpoint was wrong. Mutations: route by the runtime id instead of
      the profile id, run both deletes, apply the profile routing only when
      the profile list happens to have loaded, and treat a bound 409 as an
      ordinary failure that closes the dialog.

  #2  Reset in the filter sheet called `clearFilters()` unconditionally, so a
      saved view's own definition was wiped. Mutations: reset to nothing
      inside a view, count a view's own conditions as "active" (offering a
      Reset that destroys the view), leave the date window behind, and let a
      view-fixed option be toggled off.

  #3  `pause_reason` was parsed but never read, so a server pause for want of
      a runtime read as a user pause. Mutations: drop the status guard, fold
      the two pills into one, and have the banner name an actor the directory
      has not resolved.

Run: python3 scripts/falsify-iter258-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"

PROFILE_DELETE = APP / "lib" / "runtime-profile-delete.ts"
CODEC = APP / "data" / "stores" / "issue-view-codec.ts"
PAUSE = APP / "lib" / "autopilot-pause.ts"
ROW_MENU = APP / "components" / "runtimes" / "runtime-row-menu.tsx"
DETAIL_RUNTIME = APP / "app" / "(app)" / "[workspace]" / "more" / "runtimes" / "[id].tsx"
FILTER = APP / "app" / "(app)" / "[workspace]" / "issues-filter.tsx"
PICKER = APP / "app" / "(app)" / "[workspace]" / "issues-filter-picker.tsx"
BODIES = APP / "components" / "issue" / "pickers" / "filter-picker-bodies.tsx"
AUTOPILOT_DETAIL = APP / "app" / "(app)" / "[workspace]" / "more" / "autopilots" / "[id].tsx"
AUTOPILOT_LIST = APP / "app" / "(app)" / "[workspace]" / "more" / "autopilots.tsx"
LOCALE_EN = APP / "lib" / "i18n" / "locales" / "en.json"

SUITE = [
    "lib/runtime-profile-delete.test.ts",
    "lib/filter-reset-baseline.test.ts",
    "lib/autopilot-pause.test.ts",
    "lib/iter258-wiring.test.ts",
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
    # ── #1 the two deletes are two different deletes ────────────────────────
    (
        "1. runtimeDeleteTarget names the RUNTIME id for a custom runtime — "
        "the original bug (label says profile, request kills the instance)",
        PROFILE_DELETE,
        '    return { kind: "profile", profileId };',
        '    return { kind: "runtime", runtimeId: runtime.id ?? "" };',
    ),
    (
        "2. a profile target ALSO runs the runtime delete (a 'fix' that is "
        "worse than the bug: the instance dies too)",
        PROFILE_DELETE,
        '  if (target.kind === "profile") {\n'
        '    deps.deleteProfile(target.profileId);\n'
        '    return;\n'
        '  }',
        '  if (target.kind === "profile") {\n'
        '    deps.deleteProfile(target.profileId);\n'
        '    deps.deleteRuntime(target.profileId);\n'
        '    return;\n'
        '  }',
    ),
    (
        "3. an empty profile_id is read as truthy, routing a built-in runtime "
        "to the profile endpoint with an empty id",
        PROFILE_DELETE,
        '  if (typeof profileId === "string" && profileId.length > 0) {',
        '  if (typeof profileId === "string") {',
    ),
    (
        "4. a bound 409 closes the dialog instead of keeping it open",
        PROFILE_DELETE,
        '      ? { keepsDialogOpen: true, message: serverMessage, fromServer: true }',
        '      ? { keepsDialogOpen: false, message: serverMessage, fromServer: true }',
    ),
    (
        "5. an empty server message on a 409 loses the refusal entirely "
        "(dialog stays open but says nothing)",
        PROFILE_DELETE,
        '      : { keepsDialogOpen: true, message: fallback, fromServer: false };',
        '      : { keepsDialogOpen: false, message: fallback, fromServer: false };',
    ),
    (
        "6. the row menu routes delete-profile back into the runtime flow "
        "(the shipped bug, at the call site rather than in the helper)",
        ROW_MENU,
        '          setDeletingProfile({\n'
        '            id: profileId,\n'
        '            displayName: profile?.display_name ?? displayName,\n'
        '          });',
        '          setDeletingProfile(null);\n'
        '          requestRuntimeDelete();',
    ),
    (
        "7. the row menu takes the profile ID from the loaded LIST instead of "
        "the runtime row, so a pending list falls through to the runtime "
        "delete (web's own fallthrough, which this round rejected)",
        ROW_MENU,
        '          const profileId = runtime.profile_id;\n'
        '          if (!profileId) return;',
        '          const profileId = profile?.id;\n'
        '          if (!profileId) return requestRuntimeDelete();',
    ),
    (
        "8. the detail page's delete button goes back to the runtime flow for "
        "both kinds",
        DETAIL_RUNTIME,
        '                    const target = runtimeDeleteTarget(runtime);',
        '                    const target = runtime ? { kind: "runtime" as const, runtimeId: runtime.id } : null;',
    ),
    (
        "9. the detail page labels a custom runtime's delete with the generic "
        "runtime wording",
        DETAIL_RUNTIME,
        '                      isCustom\n'
        '                        ? "runtimes.row.deleteProfile"\n'
        '                        : "runtimes.detail.deleteButton",',
        '                      "runtimes.detail.deleteButton",',
    ),
    # ── #2 reset returns to the view ───────────────────────────────────────
    (
        "10. planFilterReset always clears — the shipped bug (Reset inside a "
        "view wipes the view's definition)",
        CODEC,
        '  return baseline\n'
        '    ? { kind: "to-view", snapshot: baseline.raw }\n'
        '    : { kind: "clear" };',
        '  return { kind: "clear" };',
    ),
    (
        "11. planFilterReset returns an EMPTY snapshot for a view (looks like "
        "a view reset, behaves like a clear)",
        CODEC,
        '    ? { kind: "to-view", snapshot: baseline.raw }',
        '    ? { kind: "to-view", snapshot: { ...baseline.raw, statusFilters: [], priorityFilters: [] } }',
    ),
    (
        "12. activeFilterDimensions ignores the baseline, so a freshly opened "
        "view offers a Reset that destroys it",
        CODEC,
        '  if (exceedsBaseline(state.statusFilters, baseline?.status)) out.push("status");',
        '  if (state.statusFilters.length > 0) out.push("status");',
    ),
    (
        "13. a view-fixed PROPERTY's addition is not counted against the "
        "baseline — additions inside a view stop being resettable",
        CODEC,
        '    if (exceedsBaseline(selected, baseline?.property.get(id))) {\n'
        '      out.push(`property:${id}` as FilterDimension);',
        '    if (selected.length > 0) {\n'
        '      out.push(`property:${id}` as FilterDimension);',
    ),
    (
        "13b. a view-fixed STATUS addition is compared against the wrong set, "
        "so adding a status inside a view never offers a Reset",
        CODEC,
        '  if (exceedsBaseline(state.statusFilters, baseline?.status)) out.push("status");',
        '  if (exceedsBaseline(state.statusFilters, baseline?.priority)) out.push("status");',
    ),
    (
        "14. the reset leaves the date window set (web nulls it right after "
        "the same branch)",
        CODEC,
        '  actions.setDateFilter(null);\n'
        '  if (state.workingOnly) actions.toggleWorkingOnly();',
        '  if (state.workingOnly) actions.toggleWorkingOnly();',
    ),
    (
        "15. the reset forgets workingOnly (a Reset that leaves a quick filter "
        "on reads as a broken button)",
        CODEC,
        '  actions.setDateFilter(null);\n'
        '  if (state.workingOnly) actions.toggleWorkingOnly();',
        '  actions.setDateFilter(null);',
    ),
    (
        "16. the sheet goes back to a baseline-blind active check, offering "
        "Reset on a freshly opened view (which would then erase it)",
        FILTER,
        '  const hasActive = activeDimensions.length > 0;',
        '  const hasActive =\n'
        '    s.statusFilters.length > 0 ||\n'
        '    s.priorityFilters.length > 0 ||\n'
        '    s.assigneeFilters.length > 0 ||\n'
        '    s.projectFilters.length > 0;',
    ),
    (
        "17. a view-fixed STATUS option becomes togglable again (predicate "
        "still computed, gate dropped)",
        FILTER,
        '                  disabled={fixed}\n',
        '                  disabled={false}\n',
    ),
    (
        "18. view-fixed 'no assignee' becomes togglable again",
        FILTER,
        '          fixed={baseline?.includeNoAssignee === true}',
        '          fixed={false}',
    ),
    (
        "19. the picker route stops resolving the baseline, so the sub-sheets "
        "show view-fixed values as removable",
        PICKER,
        '  const baseline = useFilterSheetBaseline(resolvedScope, projectIdParam ?? null);',
        '  useFilterSheetBaseline(resolvedScope, projectIdParam ?? null);\n'
        '  const baseline = null;',
    ),
    (
        "20. the picker routes labels without their fixed set",
        PICKER,
        '          fixedIds={baseline?.label}',
        '          fixedIds={undefined}',
    ),
    (
        "21. the bodies stop disabling a fixed row (compute it, then ignore it)",
        BODIES,
        '              disabled={fixed}\n',
        '              disabled={false}\n',
    ),
    # ── #3 a system pause is not a user pause ─────────────────────────────
    (
        "22. isRuntimeRequiredPause drops the status guard, so a stale reason "
        "on an ACTIVE row renders a pause banner",
        PAUSE,
        '  return (\n'
        '    autopilot.status === "paused" &&\n'
        '    autopilot.pause_reason === PAUSE_REASON_AGENT_RUNTIME_REQUIRED\n'
        '  );',
        '  return autopilot.pause_reason === PAUSE_REASON_AGENT_RUNTIME_REQUIRED;',
    ),
    (
        "23. pauseStatusLabelKey answers for every paused row, folding the two "
        "causes back into one word — the shipped defect",
        PAUSE,
        '  return isRuntimeRequiredPause(autopilot)\n'
        '    ? "autopilots.status.pausedRuntimeRequired"\n'
        '    : null;',
        '  return autopilot.status === "paused"\n'
        '    ? "autopilots.status.pausedRuntimeRequired"\n'
        '    : null;',
    ),
    (
        "24. the banner names the assignee even when the directory is "
        "unsettled or the actor is gone (MYS-2227's rule, re-broken)",
        PAUSE,
        '  return assignee.kind === "name"',
        '  return assignee.kind !== "unsettled"',
    ),
    (
        "25. the bind-runtime jump is offered for a squad too, promising a "
        "destination whose runtime belongs to a leader",
        PAUSE,
        '  return autopilot.assignee_type === "agent";',
        '  return true;',
    ),
    (
        "26. the bind-runtime jump lands on the review screen instead of the "
        "form that owns the picker (one tap short of the fix)",
        PAUSE,
        '  return `/${workspaceSlug}/more/agents/${agentId}/edit`;',
        '  return `/${workspaceSlug}/more/agents/${agentId}`;',
    ),
    (
        "27. the detail page stops rendering the system-pause banner",
        AUTOPILOT_DETAIL,
        '{runtimeRequired ? (',
        '{false ? (',
    ),
    (
        "28. the list pill goes back to the bare status word",
        AUTOPILOT_LIST,
        '  const pill = rowStatusPill(autopilot);',
        '  const pill = statusPill(autopilot.status);',
    ),
    # ── i18n: the sentences the fixes depend on ───────────────────────────
    (
        "29. the named pause sentence loses its placeholder, turning the "
        "explanation into a template hole",
        LOCALE_EN,
        '  "autopilots.detail.pausedRuntimeRequired": "Paused because {{name}} lost its runtime. Bind a runtime, then reactivate this autopilot.",',
        '  "autopilots.detail.pausedRuntimeRequired": "Paused because the assignee lost its runtime. Bind a runtime, then reactivate this autopilot.",',
    ),
    (
        "30. the unnamed sentence grows a placeholder the caller cannot fill",
        LOCALE_EN,
        '  "autopilots.detail.pausedRuntimeRequiredUnnamed": "Paused because the assignee lost its runtime. Bind a runtime, then reactivate this autopilot.",',
        '  "autopilots.detail.pausedRuntimeRequiredUnnamed": "Paused because {{name}} lost its runtime. Bind a runtime, then reactivate this autopilot.",',
    ),
]


def main() -> int:
    green, tail = run_suite()
    print("baseline:", "GREEN" if green else "RED")
    print(tail)
    if not green:
        print("baseline is not green — fix that before mutating")
        return 1

    failures: list[str] = []
    for name, path, old, new in MUTATIONS:
        if old == new:
            print(f"[SKIP] {name}: mutation is a no-op")
            failures.append(name)
            continue
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
