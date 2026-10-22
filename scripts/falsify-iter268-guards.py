#!/usr/bin/env python3
"""Mutation-test iteration 268's pricing and cache-share fixes (MYS-2317).

Each mutation injects exactly ONE half-defect a plausible-but-wrong
implementation would have shipped, asserts the suite turns RED, then restores
and asserts GREEN again. A guard that cannot be made to fail is not a guard.

The two gaps this round closes, and what the mutations attack:

  #1  The rate table had drifted 88 rows behind upstream, in TWO copies.
      Mobile carried 61 rows; upstream `origin/main` has 149. Against 229 live
      usage rows on mu.zztweb.top that priced 199 of them at $0 while web
      priced them — $476.78 shown on the phone for $986.97 of real spend. The
      table now lives once, in `lib/model-pricing.ts`, with a script that
      compares it to upstream. The failure modes:
        - the two 5.5 models this workspace actually runs go missing again;
        - the 5.5 rows inherit their 5.0 predecessor's cache-read rate, which
          is the plausible copy-paste and overstates cache reads ~20x;
        - the Gemini family (entirely absent) is skipped again;
        - the Cursor per-SKU rows are skipped, leaving every Cursor Claude run
          at $0 because its id is provider-qualified;
        - a `-fast` tier is folded onto its standard row by over-eager
          normalization, halving a premium SKU;
        - provider prefixes are peeled ONE layer, so a nested Hermes id
          (`custom:anthropic/…`) never resolves;
        - the `:` separator is not recognized at all;
        - a startsWith fallback creeps in, so an unpriced variant silently
          borrows a near-named relative's rate (web forbids exactly this);
        - a bare generic id borrows a provider-qualified row;
        - the user's overrides are consulted BEFORE the table, so a stale
          override beats a maintained price;
        - either consumer grows its own copy of the table back;
        - the two venues price the same row differently;
        - the `[1m]` tag is no longer stripped, so every 1M-context run is $0;
        - Anthropic dot ids stop normalizing (Copilot reports dots);
        - the Gemini display-label normalization is dropped.

  #2  The cache hit rate divided by (input + cacheRead), omitting cache
      writes — input-side tokens that were NOT served from cache. On live data
      one issue read 99% where the true share is 86%, and the "no input-side
      traffic" case reported a confident 0% instead of "no figure". The
      failure modes:
        - cache writes drop back out of the denominator;
        - an incomplete rate rounds up to 100% (the exact claim the cap
          exists to prevent);
        - no input-side traffic reports 0 instead of null;
        - the runs header's share is computed from a different denominator
          than the KPI cards.

Run: python3 scripts/falsify-iter268-guards.py
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "apps" / "mobile"

W = "app/(app)/[workspace]"

TABLE = APP / "lib" / "model-pricing.ts"
TASK_USAGE = APP / "lib" / "task-usage.ts"
RUNTIME_USAGE = APP / "lib" / "runtime-usage.ts"
TIMELINE = APP / "lib" / "issue-run-timeline.ts"
PANEL = APP / "components" / "issue" / "run-timeline-panel.tsx"
DIALOG = APP / "components" / "issue" / "usage-breakdown-dialog.tsx"
RUNTIME_SECTION = APP / "components" / "runtimes" / "runtime-usage-section.tsx"

SUITE = [
    "lib/model-pricing.test.ts",
    "lib/task-usage.test.ts",
    "lib/runtime-usage.test.ts",
    "lib/runtime-usage-analyze.test.ts",
    "lib/issue-run-timeline.test.ts",
    "lib/custom-pricing-wiring.test.ts",
    "lib/run-timeline-wiring.test.ts",
    "lib/pricing-surface-wiring.test.ts",
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


MUTATIONS: list[tuple[str, Path, str, str]] = [
    # ── #1 the table is upstream's table ──────────────────────────────────
    (
        "1. the two 5.5 models this workspace actually runs are dropped again "
        "— the exact 175-of-199 live unpriced rows come back",
        TABLE,
        '  "claude-sonnet-5-5":   { input: 2,    output: 10,   cacheRead: 0.10, cacheWrite: 2.50 },\n',
        "",
    ),
    (
        "2. Sonnet 5.5 inherits Sonnet 5.0's cache-read rate — the plausible "
        "copy-paste, which overstates a cache-heavy run ~2x on that column",
        TABLE,
        '  "claude-sonnet-5-5":   { input: 2,    output: 10,   cacheRead: 0.10, cacheWrite: 2.50 },',
        '  "claude-sonnet-5-5":   { input: 2,    output: 10,   cacheRead: 0.20, cacheWrite: 2.50 },',
    ),
    (
        "3. the Gemini family is skipped again — a silent $0 for anyone "
        "running Gemini",
        TABLE,
        '  "gemini-3.8-flash": { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.75 },\n',
        "",
    ),
    (
        "4. the Cursor-only rows are skipped, so every Cursor run on a "
        "catalog id with no bare counterpart is $0 — a provider-qualified key "
        "is the only thing that can price it",
        TABLE,
        '  "cursor/glm-5.2":              { input: 1.4,  output: 4.4,  cacheRead: 0.26,  cacheWrite: 0 },\n',
        "",
    ),
    (
        "5. a `-fast` tier is folded onto its standard row, halving a premium "
        "SKU that is priced deliberately higher",
        TABLE,
        '  "cursor/claude-opus-4-7-fast": { input: 30,   output: 150,  cacheRead: 3,     cacheWrite: 37.5 },\n',
        "",
    ),
    (
        "6. provider prefixes are peeled only ONE layer, so a nested Hermes id "
        "(`custom:anthropic/claude-opus-4.7`) never resolves",
        TABLE,
        "    let rest = s;\n"
        "    for (;;) {\n"
        "      const slash = rest.indexOf(\"/\");\n"
        "      const colon = rest.indexOf(\":\");\n"
        "      const sep =\n"
        "        slash === -1 ? colon : colon === -1 ? slash : Math.min(slash, colon);\n"
        "      if (sep <= 0 || !/^[a-z][a-z0-9_-]*$/i.test(rest.slice(0, sep))) break;\n"
        "      rest = rest.slice(sep + 1);\n"
        "    }\n"
        "    return rest;\n",
        "    const sep = s.indexOf(\"/\");\n"
        "    return sep > 0 && /^[a-z][a-z0-9_-]*$/i.test(s.slice(0, sep))\n"
        "      ? s.slice(sep + 1)\n"
        "      : s;\n",
    ),
    (
        "7. the `:` provider separator is not recognized at all, so Hermes "
        "custom-provider rows are all $0",
        TABLE,
        "      const colon = rest.indexOf(\":\");\n",
        "      const colon = -1;\n",
    ),
    (
        "8. a startsWith fallback creeps in, so an unpriced variant silently "
        "borrows a near-named relative's rate (web forbids exactly this)",
        TABLE,
        "  for (const candidate of candidates) {\n"
        "    const hit = MODEL_PRICING[candidate];\n"
        "    if (hit) return hit;\n"
        "  }\n",
        "  for (const candidate of candidates) {\n"
        "    const hit = MODEL_PRICING[candidate];\n"
        "    if (hit) return hit;\n"
        "  }\n"
        "  for (const key of Object.keys(MODEL_PRICING)) {\n"
        "    if (candidates.some((c) => c.startsWith(key))) return MODEL_PRICING[key];\n"
        "  }\n",
    ),
    (
        "9. the bare form is tried BEFORE the provider-qualified form, so an "
        "unqualified generic id borrows a provider's row",
        TABLE,
        "  return [...base.map((c) => qualify(p, c)), ...base];",
        "  return [...base, ...base.map((c) => qualify(p, c))];",
    ),
    (
        "10. the user's overrides are consulted BEFORE the table, so a stale "
        "override beats a maintained price",
        TABLE,
        "  for (const candidate of candidates) {\n"
        "    const hit = MODEL_PRICING[candidate];\n"
        "    if (hit) return hit;\n"
        "  }\n"
        "  if (!overrides) return undefined;\n"
        "  for (const candidate of candidates) {\n"
        "    const hit = overrides[candidate];\n"
        "    if (hit) return hit;\n"
        "  }\n",
        "  if (overrides) {\n"
        "    for (const candidate of candidates) {\n"
        "      const hit = overrides[candidate];\n"
        "      if (hit) return hit;\n"
        "    }\n"
        "  }\n"
        "  for (const candidate of candidates) {\n"
        "    const hit = MODEL_PRICING[candidate];\n"
        "    if (hit) return hit;\n"
        "  }\n",
    ),
    (
        "11. `[1m]` context tags stop being stripped, so every 1M-context run "
        "is $0 again — this alone is 136 of the live unpriced rows",
        TABLE,
        '  const stripContextTag = (s: string) => s.replace(/\\[[^\\]]+\\]$/, "");',
        "  const stripContextTag = (s: string) => s;",
    ),
    (
        "12. Anthropic dot ids stop normalizing, so Copilot's `claude-opus-4.7` "
        "is $0 while Claude Code's `claude-opus-4-7` prices",
        TABLE,
        '    s.startsWith("claude-") ? s.replace(/\\./g, "-") : s;',
        "    s;",
    ),
    (
        "13. the Gemini display-label / effort normalization is dropped, so "
        "Antigravity's `gemini 3.8 flash` reads $0",
        TABLE,
        "    if (display) return `gemini-${display[1]}-${display[2]}`.toLowerCase();\n",
        "",
    ),
    (
        "14. the issue side grows its own copy of the table back — the exact "
        "duplication that let the two copies drift 88 rows apart",
        TASK_USAGE,
        "function resolvePricing(model: string, provider?: string): ModelPrice | undefined {",
        'const MODEL_PRICING: Record<string, ModelPrice> = {\n'
        '  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },\n'
        "};\n\n"
        "function resolvePricing(model: string, provider?: string): ModelPrice | undefined {",
    ),
    (
        "15. the runtime side grows its own copy back",
        RUNTIME_USAGE,
        "function resolveRuntimePricing(model: string, provider?: string) {",
        'const MODEL_PRICING: Record<string, ModelPrice> = {\n'
        '  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },\n'
        "};\n\n"
        "function resolveRuntimePricing(model: string, provider?: string) {",
    ),
    (
        "16. the runtime venue stops consulting the user's overrides, so a "
        "rate entered on the runtime page does not price there",
        RUNTIME_USAGE,
        "  return resolvePricing(model, provider, useCustomPricingStore.getState().pricings);",
        "  return resolvePricing(model, provider);",
    ),
    # ── #2 the cache share counts every input-side bucket ─────────────────
    (
        "17. cache writes drop back out of the denominator — the pre-fix "
        "math, which reported 99% on a run that wrote 57K tokens into cache",
        TABLE,
        "  const inputSideTokens = inputTokens + cacheReadTokens + cacheWriteTokens;\n",
        "  const inputSideTokens = inputTokens + cacheReadTokens;\n",
    ),
    (
        "18. an incomplete rate rounds up to 100% — the exact claim the cap "
        "exists to prevent",
        TABLE,
        "  return percent === 100 ? 100 : Math.min(Math.round(percent), 99);",
        "  return Math.round(percent);",
    ),
    (
        "19. no input-side traffic reports a confident 0% instead of "
        "\"no figure\"",
        TABLE,
        "  if (inputSideTokens <= 0) return null;",
        "  if (inputSideTokens <= 0) return 0;",
    ),
    (
        "20. the ratio form keeps its own denominator, so the runs header and "
        "the KPI cards can quote different shares for one set of tokens",
        TABLE,
        "  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;",
        "  const prompt = tokens.input + tokens.cacheRead;",
    ),
    (
        "21. the per-issue usage sheet goes back to its inline floor-of-"
        "(input+cacheRead) math, ignoring cache writes and claiming a "
        "confident 0% with no input",
        DIALOG,
        "  const cacheHitRate = total\n"
        "    ? cacheHitRatePercent(total.input, total.cacheRead, total.cacheWrite)\n"
        "    : null;",
        "  const cacheHitRate =\n"
        "    total && total.input + total.cacheRead > 0\n"
        "      ? Math.floor((total.cacheRead / (total.input + total.cacheRead)) * 100)\n"
        "      : 0;",
    ),
    (
        "22. the runtime page goes back to its inline round-of-"
        "(input+cacheRead) math",
        RUNTIME_SECTION,
        "  const cacheHitRate = cacheHitRatePercent(\n"
        "    totals.input,\n"
        "    totals.cacheRead,\n"
        "    totals.cacheWrite,\n"
        "  );",
        "  const cacheable = totals.input + totals.cacheRead;\n"
        "  const cacheHitRate =\n"
        "    cacheable > 0 ? Math.round((totals.cacheRead / cacheable) * 100) : 0;",
    ),
    # ── the runs header states the same figures web does ──────────────────
    (
        "23. the timeline stops summing token buckets, so the header's cache "
        "share has no denominator to divide",
        TIMELINE,
        "      tokens.input += run.usage.input;\n",
        "",
    ),
    (
        "24. the token total counts only input + output, dropping the cache "
        "buckets — the share of an agent's traffic that is cache reads is the "
        "larger half, so the header would understate an issue's real volume",
        TIMELINE,
        "      tokens.total += run.usage.tokens;\n",
        "      tokens.total += run.usage.input + run.usage.output;\n",
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
