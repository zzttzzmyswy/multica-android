#!/usr/bin/env python3
"""Compare mobile's pricing RESOLVER against upstream's, behaviourally.

Iteration 268 built `sync-model-pricing.py`, which compares the rate TABLE row
by row. That gate passed here — the table in `apps/mobile/lib/model-pricing.ts`
is byte-identical to `origin/main`'s, all 149 rows. The defect this script
exists for lived one layer below it, in the resolver:

    Upstream `cursorPricingCandidates` treats a Cursor model id as a base SKU
    plus variant parts and strips them (`claude-opus-4-7-thinking-high-fast` →
    `cursor/claude-opus-4-7`), while keeping `-fast` distinct because a Fast SKU
    bills above its standard row. Mobile had no such path, so every variant id
    missed every row and priced at $0 — silently, because the table looked
    perfect and the only "two entries agree" tests compared mobile to itself.

A table check cannot see that. This one can: it extracts upstream's resolver
from `origin/main`, runs the SAME corpus of model ids and providers through
both implementations, and fails on any disagreement in the returned rate.

Usage:
  scripts/check-pricing-resolver-parity.py          # report, exit 1 on drift
  scripts/check-pricing-resolver-parity.py --verbose # print each divergence

Both sides are executed, not compared as text — a reformat or a renamed local
is not drift, and a semantically different resolver is, whatever it looks like.
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOBILE = ROOT / "apps" / "mobile" / "lib" / "model-pricing.ts"
UPSTREAM_PATH = "packages/views/runtimes/utils.ts"
UPSTREAM_REF = "origin/main"

# Everything the resolver needs from upstream, in dependency order. Missing one
# of these is a hard error rather than a skip: a gate that quietly stops
# checking is worse than no gate.
UPSTREAM_PIECES = [
    "MODEL_PRICING",
    "Priceable",
    "normalizeProvider",
    "qualify",
    "canonicalCandidates",
    "cursorBaseModel",
    "cursorPricingCandidates",
    "pricingCandidates",
    "resolvePricing",
    "isModelPriced",
]

# Corpus. Deliberately wide rather than curated: the point is to catch a
# resolver difference nobody thought to write an example for, and the cost of
# a few hundred thousand string lookups is a couple of seconds.
PROVIDERS = [
    "cursor",
    "Cursor",  # case drift
    " cursor ",  # whitespace drift
    "claude",
    "codex",
    "opencode",
    "copilot",
    "antigravity",
    "grok",
    "xai",
    "dsh",
    "pi",
    "hermes",
    "zeroclaw",
    "openai",
    "",
    None,
]
PREFIXES = [
    "",
    "anthropic/",
    "custom:anthropic/",
    "custom:anthropic/vertex-anthropic/",  # nested provider peel
    "openrouter:",
    "cursor/",
    "openai/",
]
SUFFIXES = [
    "",
    # Cursor variant parts, in the orders Cursor actually emits them.
    "-high",
    "-max",
    "-low",
    "-medium",
    "-xhigh",
    "-extra-high",
    "-none",
    "-minimal",
    "-thinking",
    "-thinking-high",
    "-high-fast",
    "-fast",
    "-medium-thinking",
    "[1m]",
    "[fast=true]",
    "[effort=high,fast=true]",
    "[context=1m,effort=high,fast=false]",
    # Non-Cursor tolerances, so a regression there is caught by the same gate.
    "-20250929",
    "-latest",
    " (high)",
]
EXTRA_BASES = [
    "auto",
    "composer-2",
    "sonnet",
    "sonnet[1m]",
    "opus[1m]",
    "haiku[1m]",
    "sonnetp[1m]",
    "claude-opus-4.7",
    "gemini 3.8 flash",
    "gemini-3.8-flash-high",
    "gpt-5.5-mini",  # must stay unmapped: no startsWith borrowing
    "cursor-grok-4.6",
    "muse-wonder-1.0",
    "kimi-k3",
    "unknown",
]


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


def declaration_ranges(src: str) -> dict:
    """Top-level `function` / `const` / `interface` / `type` name → line span."""
    lines = src.splitlines()
    starts = []
    for i, line in enumerate(lines):
        m = re.match(r"(?:export )?(?:function|const|interface|type|class) (\w+)", line)
        if m and not line.startswith(" "):
            starts.append((i, m.group(1)))
    out = {}
    for k, (i, name) in enumerate(starts):
        end = starts[k + 1][0] - 1 if k + 1 < len(starts) else len(lines) - 1
        while end > i and not lines[end].strip():
            end -= 1
        out[name] = (i, end + 1)
    return out


def upstream_fixture(src: str) -> str:
    """Upstream's resolver as a standalone module Node can execute.

    Comments inside each declaration are kept (they explain the rules); only
    the `export` keyword is dropped, because this file exports its own set.
    """
    lines = src.splitlines()
    ranges = declaration_ranges(src)
    missing = [p for p in UPSTREAM_PIECES if p not in ranges]
    if missing:
        raise SystemExit(
            f"upstream {UPSTREAM_REF}:{UPSTREAM_PATH} no longer declares {missing}. "
            "The resolver was restructured — re-derive this gate against the new shape "
            "instead of deleting the check."
        )

    chunks = [
        f"/* extracted from {UPSTREAM_REF}:{UPSTREAM_PATH} at check time; not shipped. */",
        # `CURSOR_VARIANT_SUFFIX` is a module-private const the pieces below
        # reference; it is not exported upstream, so it is re-stated here and
        # the parity of its BEHAVIOUR is what the corpus proves.
        "const CURSOR_VARIANT_SUFFIX = /-(?:fast|thinking|none|minimal|low|medium|high|xhigh|extra-high|max)$/;",
        "const canonicalCandidatesCache = new Map<string, string[]>();",
        "const OVERRIDES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {};",
        "const getCustomPricing = (k: string) => OVERRIDES[k];",
    ]
    for piece in UPSTREAM_PIECES:
        start, end = ranges[piece]
        text = "\n".join(lines[start:end])
        text = re.sub(r"^export (function|const|interface|type|class) ", r"\1 ", text, flags=re.M)
        chunks.append(text)
    chunks.append(
        "export { resolvePricing as upstreamResolve, canonicalCandidates as upstreamCandidates };"
    )
    return "\n\n".join(chunks) + "\n"


def corpus(upstream_table_keys) -> list:
    bases = list(upstream_table_keys) + EXTRA_BASES
    seen = set()
    out = []
    for provider in PROVIDERS:
        for prefix in PREFIXES:
            for base in bases:
                for suffix in SUFFIXES:
                    model = prefix + base + suffix
                    key = (model, provider)
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(key)
    return out


HARNESS = """
const mobile = await import({mobile_url});
const upstream = await import({upstream_url});
const cases = JSON.parse(await (await import("node:fs/promises")).readFile({cases_path}, "utf8"));
const divergences = [];
for (const [model, provider] of cases) {{
  const a = mobile.resolvePricing(model, provider) ?? null;
  const b = upstream.upstreamResolve(model, provider) ?? null;
  if (JSON.stringify(a) !== JSON.stringify(b)) {{
    divergences.push({{ model, provider, mobile: a, upstream: b }});
  }}
}}
const tableKeys = Object.keys(upstream.UPSTREAM_TABLE ?? {{}});
process.stdout.write(JSON.stringify({{ checked: cases.length, divergences, tableRows: tableKeys.length }}));
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verbose", action="store_true", help="print every divergence")
    ap.add_argument("--limit", type=int, default=40, help="divergences to print")
    args = ap.parse_args()

    src = upstream_source()
    ranges = declaration_ranges(src)
    # The table keys seed the corpus, so a row upstream adds is exercised even
    # before anyone writes an example for it.
    table_start, table_end = ranges["MODEL_PRICING"]
    table_text = "\n".join(src.splitlines()[table_start:table_end])
    table_keys = sorted({
        m.group(1)
        for m in re.finditer(r'^\s*"([^"]+)":\s*\{\s*input:', table_text, re.M)
    })

    cases = corpus(table_keys)
    tmp = Path(tempfile.mkdtemp(prefix="pricing-parity-"))
    try:
        up_path = tmp / "upstream.mts"
        up_path.write_text(upstream_fixture(src))
        cases_path = tmp / "cases.json"
        cases_path.write_text(json.dumps(cases))
        harness_path = tmp / "run.mjs"
        harness_path.write_text(
            HARNESS.format(
                mobile_url=json.dumps(MOBILE.as_uri()),
                upstream_url=json.dumps(up_path.as_uri()),
                cases_path=json.dumps(str(cases_path)),
            )
        )
        proc = subprocess.run(
            ["node", str(harness_path)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr)
            raise SystemExit(
                "the parity harness failed to run — this is a gate failure, not a skip"
            )
        # Node prints a MODULE_TYPELESS_PACKAGE_JSON notice on stderr for the
        # .ts import; only stdout carries the result.
        result = json.loads(proc.stdout)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    divergences = result["divergences"]
    if not divergences:
        print(
            "pricing resolver: in sync with "
            f"{UPSTREAM_REF} ({result['checked']} ids × providers over "
            f"{len(table_keys)} upstream rows, 0 divergences)"
        )
        return 0

    print(
        f"pricing resolver: DRIFT vs {UPSTREAM_REF} — "
        f"{len(divergences)} of {result['checked']} cases disagree"
    )
    by_provider = {}
    for d in divergences:
        key = (d["provider"] or "").strip().lower() or "(none)"
        by_provider[key] = by_provider.get(key, 0) + 1
    print("  by provider: " + ", ".join(f"{k}={v}" for k, v in sorted(by_provider.items())))
    shown = divergences if args.verbose else divergences[: args.limit]
    for d in shown:
        print(
            f"  {d['provider']!r:<14} {d['model']!r}\n"
            f"      mobile:   {json.dumps(d['mobile'])}\n"
            f"      upstream: {json.dumps(d['upstream'])}"
        )
    if not args.verbose and len(divergences) > len(shown):
        print(f"  … {len(divergences) - len(shown)} more (--verbose to list all)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
