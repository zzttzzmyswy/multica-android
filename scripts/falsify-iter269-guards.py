#!/usr/bin/env python3
"""Mutation-test iteration 269's Cursor-resolver fix (MYS-2317).

Each mutation injects exactly ONE half-defect a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts GREEN again. A guard that cannot be made to fail is not a guard.

The gap this round closes, and why the previous gate missed it:

  Iteration 268 made the rate TABLE upstream's table and built
  `sync-model-pricing.py` to compare it row by row. That gate is green today —
  all 149 rows match. The bug lived UNDER it: upstream's resolver has a
  Cursor-only branch that splits a catalog id into `<base> + <variant parts>`
  (`claude-opus-4-7-thinking-high-fast`), and mobile's resolver had none of it.
  So every variant Cursor id missed every row and priced at $0 — and the table
  check could not see it, because the table was correct.

  Measured against upstream's resolver over 395k (model, provider) pairs built
  from every upstream row × 17 providers × 23 variant suffixes: 11,505 cases
  where mobile returned null and upstream returned a rate. All Cursor, because
  Cursor is the only provider whose ids carry the variant inline.

The failure modes this gate attacks:

  - the Cursor branch is dropped (the bug itself comes back);
  - the branch is applied to every provider, inventing rates for ids no vendor
    publishes (`claude-opus-5-5-high` on the Claude provider);
  - `-fast` is stripped like any other variant, so a premium SKU is priced at
    its standard row (a silent UNDER-report, the opposite of $0 and equally
    invisible to a "did it price" test);
  - `[fast=true]` is stripped as a generic context tag before the parameter
    list is read, so a parameterized Fast id borrows the cheaper row;
  - `-fast` is dropped from the strip list entirely, so a Fast id falls back to
    the base row through the canonical path;
  - a Fast variant with no published Fast rate borrows the standard one instead
    of staying unmapped;
  - effort / thinking levels are NOT stripped, so the base row is unreachable;
  - the `cursor-` prefix on a model id is kept, so `cursor-grok-4.6` misses;
  - the provider key is matched un-normalized, so a row reporting `Cursor`
    takes the generic path;
  - variant stripping runs BEFORE the exact id is tried, so an exact
    `cursor/<id>` row can never win.

Run: python3 scripts/falsify-iter269-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"
TABLE = APP / "lib" / "model-pricing.ts"

SUITE = [
    "lib/model-pricing.test.ts",
    "lib/task-usage.test.ts",
    "lib/runtime-usage.test.ts",
    "lib/runtime-usage-analyze.test.ts",
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


BRANCH = (
    '  if (!p) return base;\n'
    '  if (p === "cursor") return cursorPricingCandidates(model, base);\n'
)

FAST_ONLY = (
    '  const { base, fast } = cursorBaseModel(model);\n'
    '  if (fast) return [qualify("cursor", model), `cursor/${base}-fast`];\n'
)

STRIP_LOOP = (
    '  for (\n'
    '    let m = id.match(CURSOR_VARIANT_SUFFIX);\n'
    '    m;\n'
    '    m = id.match(CURSOR_VARIANT_SUFFIX)\n'
    '  ) {\n'
    '    if (m[0] === "-fast") fast = true;\n'
    '    id = id.slice(0, m.index);\n'
    '  }\n'
)

PARAMS = (
    '  const params = id.match(/\\[([^\\]]*)\\]$/);\n'
    '  if (params) {\n'
    '    fast = /(?:^|,)\\s*fast\\s*=\\s*true\\s*(?:,|$)/.test(params[1] ?? "");\n'
    '    id = id.slice(0, params.index);\n'
    '  }\n'
)

MUTATIONS: list[tuple[str, Path, str, str]] = [
    # ── the branch exists and is reachable ────────────────────────────────
    (
        "1. the Cursor branch is dropped — the exact defect this iteration "
        "found, where every variant Cursor id prices at $0",
        TABLE,
        BRANCH,
        "  if (!p) return base;\n",
    ),
    (
        "2. the branch is applied to EVERY provider, inventing rates for ids "
        "no vendor publishes (`claude-opus-5-5-high` on the Claude provider)",
        TABLE,
        BRANCH,
        '  if (!p) return base;\n'
        '  return cursorPricingCandidates(model, base);\n',
    ),
    (
        "3. the provider is matched un-normalized, so a row reporting `Cursor` "
        "or ` cursor ` takes the generic path and prices $0",
        TABLE,
        '  if (p === "cursor") return cursorPricingCandidates(model, base);\n',
        '  if (provider === "cursor") return cursorPricingCandidates(model, base);\n',
    ),
    # ── fast is a RATE, not a naming variant ──────────────────────────────
    (
        "4. `-fast` is stripped like any other variant, so a premium SKU is "
        "priced at its standard row — a silent under-report",
        TABLE,
        '    if (m[0] === "-fast") fast = true;\n',
        "",
    ),
    (
        "5. `-fast` leaves the strip list entirely, so a Fast id reaches the "
        "base row through the canonical path instead of its own `-fast` row",
        TABLE,
        "const CURSOR_VARIANT_SUFFIX =\n"
        '  /-(?:fast|thinking|none|minimal|low|medium|high|xhigh|extra-high|max)$/;\n',
        "const CURSOR_VARIANT_SUFFIX =\n"
        '  /-(?:thinking|none|minimal|low|medium|high|xhigh|extra-high|max)$/;\n',
    ),
    (
        "6. `[fast=true]` is stripped as a generic context tag before the "
        "parameter list is read, so it borrows the cheaper standard row",
        TABLE,
        PARAMS,
        '  id = id.replace(/\\[[^\\]]*\\]$/, "");\n',
    ),
    (
        "7. a Fast variant with no published Fast rate borrows the standard "
        "one instead of staying unmapped",
        TABLE,
        FAST_ONLY,
        '  const { base } = cursorBaseModel(model);\n',
    ),
    (
        "8. the Fast path also tries the base row, so an unpublished Fast rate "
        "silently resolves at standard price",
        TABLE,
        '  if (fast) return [qualify("cursor", model), `cursor/${base}-fast`];\n',
        '  if (fast)\n'
        '    return [\n'
        '      qualify("cursor", model),\n'
        '      `cursor/${base}-fast`,\n'
        '      `cursor/${base}`,\n'
        '    ];\n',
    ),
    # ── the base derivation is what actually finds the row ────────────────
    (
        "9. effort / thinking levels are NOT stripped, so the base row is "
        "unreachable and every effort-suffixed id is $0",
        TABLE,
        '  /-(?:fast|thinking|none|minimal|low|medium|high|xhigh|extra-high|max)$/;\n',
        '  /-(?:fast)$/;\n',
    ),
    (
        "10. the `cursor-` prefix on a model id is kept, so "
        "`cursor-grok-4.6-high` misses the `grok-4.6` row",
        TABLE,
        '  return { base: id.replace(/^cursor-/, ""), fast };\n',
        "  return { base: id, fast };\n",
    ),
    (
        "11. the variant strip runs only ONCE, so ids carrying two variant "
        "parts (`-thinking-high-fast`) keep a suffix and miss",
        TABLE,
        STRIP_LOOP,
        "  const single = id.match(CURSOR_VARIANT_SUFFIX);\n"
        "  if (single) {\n"
        '    if (single[0] === "-fast") fast = true;\n'
        "    id = id.slice(0, single.index);\n"
        "  }\n",
    ),
    (
        "12. the base row is tried AFTER the bare vendor row, so a Cursor-only "
        "SKU loses to a bare row with different rates",
        TABLE,
        "  return [...new Set([...qualified, `cursor/${base}`, base, ...canonical])];\n",
        "  return [...new Set([...qualified, base, `cursor/${base}`, ...canonical])];\n",
    ),
    (
        "13. the case/whitespace trim is dropped, so `  Claude-Opus-5-5-High  ` "
        "from the wire never reaches its row",
        TABLE,
        "  let id = model.trim().toLowerCase();\n",
        "  let id = model;\n",
    ),
]


def find(path: Path, needle: str) -> int:
    return path.read_text().count(needle)


_snapshot: dict[Path, str] = {}


def snapshot() -> None:
    for path in {m[1] for m in MUTATIONS}:
        _snapshot[path] = path.read_text()


def restore() -> None:
    for path, text in _snapshot.items():
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
