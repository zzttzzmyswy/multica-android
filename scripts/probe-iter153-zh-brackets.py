#!/usr/bin/env python3
"""Measure the zh bracket pair counts at a given git revision.

The zh-typography guard derives "zh uses full-width brackets everywhere" from a
majority with stragglers, and the 151 sweep converged the stragglers. The
before-counts (70 views + 36 mobile full-width, 4 + 1 half-width) are stated in
the suite's prose and never re-derived. This script reads them off any revision
so the converged claim can be written with numbers that were actually measured.

Usage: python3 scripts/probe-iter153-zh-brackets.py <rev> [<rev> ...]
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CODE_SPAN = re.compile(r"`[^`]*`")
FULL = re.compile(r"（[^（）]*）")
HALF = re.compile(r"\([^()]*\)")


def flatten(value, prefix=""):
    if not isinstance(value, dict):
        return {prefix: str(value)}
    out = {}
    for key, child in value.items():
        out.update(flatten(child, f"{prefix}.{key}" if prefix else key))
    return out


def show(path: str, rev: str) -> dict:
    raw = subprocess.run(
        ["git", "show", f"{rev}:{path}"], cwd=ROOT, capture_output=True, text=True, check=True
    ).stdout
    return flatten(json.loads(raw))


def views(rev: str) -> dict:
    bundle = {}
    for ns in sorted((ROOT / "packages/views/locales/zh-Hans").glob("*.json")):
        for key, value in show(f"packages/views/locales/zh-Hans/{ns.name}", rev).items():
            bundle[f"{ns.stem}.{key}"] = value
    return bundle


def counts(bundle: dict) -> tuple[int, int]:
    full = half = 0
    for value in bundle.values():
        masked = CODE_SPAN.sub(" ", value)
        full += len(FULL.findall(masked))
        half += len(HALF.findall(masked))
    return full, half


def main() -> None:
    for rev in sys.argv[1:]:
        v_full, v_half = counts(views(rev))
        m_full, m_half = counts(show("apps/mobile/lib/i18n/locales/zh.json", rev))
        print(f"{rev}")
        print(f"  views zh-Hans : full-width {v_full:3d}  half-width {v_half:3d}")
        print(f"  mobile zh     : full-width {m_full:3d}  half-width {m_half:3d}")


if __name__ == "__main__":
    main()
