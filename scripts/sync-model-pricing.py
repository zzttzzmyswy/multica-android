#!/usr/bin/env python3
"""Keep `apps/mobile/lib/model-pricing.ts` equal to upstream's rate table.

Iteration 268 exists because that table drifted: mobile carried 61 rows,
upstream had 149, and the 88 missing ones priced 199 of 229 live usage rows at
$0 while web priced them. The one-off fix was to re-copy the table; the thing
that stops it happening again is this script, which re-derives the table from
`origin/main:packages/views/runtimes/utils.ts` and compares row-by-row.

Usage:
  scripts/sync-model-pricing.py           # report drift, exit 1 if any
  scripts/sync-model-pricing.py --check   # same (the CI/iteration gate)
  scripts/sync-model-pricing.py --write    # rewrite the mobile table in place

`--write` only ever touches the block between the `const MODEL_PRICING` line
and its closing `};`, so the module's own docblocks survive. It never edits
upstream — the direction is web → mobile, because upstream is where a price is
decided and a run has to cost the same number on both clients.

Row comparison is by KEY and by the four RATES, not by text: upstream
realigns its columns when a number gets wider, and a reformat is not drift.
A row whose key moved but whose numbers match is drift; so is a row that
exists on only one side.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps" / "mobile" / "lib" / "model-pricing.ts"
UPSTREAM_PATH = "packages/views/runtimes/utils.ts"
UPSTREAM_REF = "origin/main"

ROW_RE = re.compile(
    r'^\s*"([^"]+)":\s*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+),'
    r"\s*cacheRead:\s*([\d.]+),\s*cacheWrite:\s*([\d.]+)\s*\}",
    re.M,
)


def table_block(src: str) -> str:
    """The `{...}` body of a `const MODEL_PRICING` declaration."""
    start = src.index("const MODEL_PRICING")
    open_brace = src.index("= {", start) + 2
    depth = 0
    for i in range(open_brace, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[open_brace : i + 1]
    raise SystemExit("unterminated MODEL_PRICING block")


def parse(block: str) -> dict:
    return {
        m.group(1): tuple(float(m.group(i)) for i in (2, 3, 4, 5))
        for m in ROW_RE.finditer(block)
    }


def upstream_source() -> str:
    try:
        return subprocess.check_output(
            ["git", "show", f"{UPSTREAM_REF}:{UPSTREAM_PATH}"],
            cwd=ROOT,
            text=True,
            stderr=subprocess.PIPE,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise SystemExit(
            f"cannot read {UPSTREAM_REF}:{UPSTREAM_PATH} — run `git fetch origin` first ({exc})"
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--write",
        action="store_true",
        help="rewrite the mobile table from upstream instead of only reporting",
    )
    ap.add_argument(
        "--check",
        action="store_true",
        help="report-only (the default; kept for symmetry with other gates)",
    )
    args = ap.parse_args()

    theirs = parse(table_block(upstream_source()))
    mine_src = MOBILE.read_text()
    mine = parse(table_block(mine_src))

    missing = sorted(set(theirs) - set(mine))
    extra = sorted(set(mine) - set(theirs))
    drift = sorted(k for k in set(theirs) & set(mine) if theirs[k] != mine[k])

    if args.write:
        if not (missing or extra or drift):
            print(f"model-pricing: already in sync ({len(mine)} rows)")
            return 0
        their_block = table_block(upstream_source())
        old_block = table_block(mine_src)
        MOBILE.write_text(mine_src.replace(old_block, their_block, 1))
        print(
            "model-pricing: rewrote the table from "
            f"{UPSTREAM_REF} ({len(mine)} → {len(theirs)} rows; "
            f"{len(missing)} added, {len(extra)} removed, {len(drift)} re-rated)"
        )
        return 0

    if not (missing or extra or drift):
        print(f"model-pricing: in sync with {UPSTREAM_REF} ({len(mine)} rows)")
        return 0

    print(f"model-pricing: DRIFT vs {UPSTREAM_REF} ({len(theirs)} rows)")
    for key in missing:
        print(f"  missing from mobile: {key} = {theirs[key]}")
    for key in extra:
        print(f"  not upstream any more: {key} = {mine[key]}")
    for key in drift:
        print(f"  rate changed: {key}: mobile {mine[key]} vs upstream {theirs[key]}")
    print("\nRun `scripts/sync-model-pricing.py --write` to take upstream's table.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
