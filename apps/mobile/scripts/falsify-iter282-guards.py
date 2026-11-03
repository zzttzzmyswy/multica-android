#!/usr/bin/env python3
"""Mutation-test iteration 282's permission fix (MYS-2550).

Each mutation injects exactly ONE half-defect that a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts it turns GREEN again. A guard that cannot be made to fail is not a
guard (the repo's standing discipline, scripts/falsify-*.py).

The defect this round closes: mobile's mirror of the agent-invocation rule read
the DERIVED `visibility` field instead of the authoritative `permission_mode` +
`invocation_targets`, so it disagreed with both web and the server in BOTH
directions (an admin passed on someone else's private agent; a granted member
was refused). Separately, the issue assignee picker consulted only the runtime,
so no permission gate existed on that surface at all.

Mutations:

  #1  Reading the derived field again (the defect itself).
  #2  Restoring the admin bypass on private mode (the old model's second half).
  #3  Treating team grants as real grants (the server keeps them inert).
  #4  Treating an unknown mode as public_to (core's fallthrough, not the
      server's).
  #5  Dropping the permission gate from the assignee picker, leaving only the
      runtime one.
  #6  Letting permission and runtime swap precedence on a blocked row.
"""
import subprocess
import sys
import pathlib

APP = pathlib.Path(__file__).resolve().parent.parent
RULE = APP / "lib/can-assign-agent.ts"
PICKER = APP / "components/issue/pickers/assignee-picker-body.tsx"

MUTATIONS = [
    (
        "read the derived visibility field again (the defect itself)",
        RULE,
        "  if (agent.owner_id != null && agent.owner_id === userId) return true;",
        "  if ((agent as { visibility?: string }).visibility === \"workspace\") return true;\n"
        "  if (agent.owner_id != null && agent.owner_id === userId) return true;",
        ["lib/can-assign-agent.test.ts", "lib/can-assign-agent-parity.test.ts"],
    ),
    (
        "restore the admin bypass on private mode (the old model)",
        RULE,
        "    return false;\n  }",
        "    return memberRole === \"owner\" || memberRole === \"admin\";\n  }",
        ["lib/can-assign-agent.test.ts"],
    ),
    (
        "treat team grants as real grants",
        RULE,
        "    (t) => t.target_type === \"member\" && t.target_id === userId,",
        "    (t) =>\n"
        "      (t.target_type === \"member\" || t.target_type === \"team\") &&\n"
        "      t.target_id === userId,",
        ["lib/can-assign-agent.test.ts"],
    ),
    (
        "treat an unknown mode as public_to (core's fallthrough)",
        RULE,
        "  if (mode !== \"public_to\") {",
        "  if (mode === \"private\") {",
        ["lib/can-assign-agent-parity.test.ts"],
    ),
    (
        "drop the permission gate from the assignee picker",
        PICKER,
        "          userId,\n          role,\n        });",
        "        });",
        ["lib/can-assign-agent-wiring.test.ts", "lib/assignee-row-gate.test.ts"],
    ),
    (
        "accept any role string, so a non-member passes the workspace branch",
        RULE,
        "  return memberRole === \"owner\" || memberRole === \"admin\" || memberRole === \"member\"\n    ? memberRole\n    : null;",
        "  return memberRole;",
        ["lib/can-assign-agent.test.ts"],
    ),
]


def run(tests):
    proc = subprocess.run(
        ["npx", "vitest", "run", *tests, "--reporter=dot"],
        cwd=APP,
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main():
    failures = 0
    for index, (label, path, old, new, tests) in enumerate(MUTATIONS, start=1):
        original = path.read_text()
        if old not in original:
            print(f"#{index} SKIP (anchor not found): {label}")
            failures += 1
            continue
        try:
            path.write_text(original.replace(old, new, 1))
            code, out = run(tests)
            if code == 0:
                print(f"#{index} FAIL (suite stayed GREEN): {label}")
                failures += 1
            else:
                print(f"#{index} ok (suite turned RED): {label}")
        finally:
            path.write_text(original)

    code, _ = run([
        "lib/can-assign-agent.test.ts",
        "lib/can-assign-agent-parity.test.ts",
        "lib/can-assign-agent-wiring.test.ts",
        "lib/assignee-row-gate.test.ts",
    ])
    if code != 0:
        print("RESTORE FAILED: suite is not green after restoring the sources")
        failures += 1
    else:
        print("restore ok: suite green again")

    print("---")
    print("ALL GUARDS FALSIFIED" if failures == 0 else f"{failures} PROBLEM(S)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
