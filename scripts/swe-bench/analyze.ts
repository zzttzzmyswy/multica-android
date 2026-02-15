#!/usr/bin/env tsx
/**
 * Analyze SWE-bench run results.
 *
 * Reads the .results.jsonl file produced by run.ts and prints a summary.
 *
 * Usage:
 *   tsx scripts/swe-bench/analyze.ts [results.jsonl]
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

interface RunResult {
  instance_id: string;
  success: boolean;
  patch: string;
  error?: string;
  duration_ms: number;
  session_id: string;
}

function main() {
  const resultsPath = resolve(
    process.argv[2] || "scripts/swe-bench/predictions.results.jsonl",
  );

  if (!existsSync(resultsPath)) {
    console.error(`Results file not found: ${resultsPath}`);
    process.exit(1);
  }

  const lines = readFileSync(resultsPath, "utf-8").split("\n").filter(Boolean);
  const results: RunResult[] = lines.map((l) => JSON.parse(l));

  const total = results.length;
  const patched = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const errors = results.filter((r) => r.error).length;
  const durations = results.map((r) => r.duration_ms);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / total;
  const maxDuration = Math.max(...durations);
  const minDuration = Math.min(...durations);
  const patchSizes = results
    .filter((r) => r.success)
    .map((r) => r.patch.length);
  const avgPatchSize =
    patchSizes.length > 0
      ? patchSizes.reduce((a, b) => a + b, 0) / patchSizes.length
      : 0;

  console.log("=== SWE-bench Run Analysis ===\n");
  console.log(`Total tasks:     ${total}`);
  console.log(`Patched:         ${patched} (${((patched / total) * 100).toFixed(1)}%)`);
  console.log(`No patch:        ${failed}`);
  console.log(`Errors:          ${errors}`);
  console.log();
  console.log(`Avg duration:    ${(avgDuration / 1000).toFixed(1)}s`);
  console.log(`Min duration:    ${(minDuration / 1000).toFixed(1)}s`);
  console.log(`Max duration:    ${(maxDuration / 1000).toFixed(1)}s`);
  console.log(`Avg patch size:  ${(avgPatchSize / 1024).toFixed(1)}KB`);

  // Error breakdown
  if (errors > 0) {
    console.log("\n--- Errors ---");
    const errorCounts = new Map<string, number>();
    for (const r of results) {
      if (r.error) {
        const key = r.error.length > 60 ? r.error.slice(0, 60) + "..." : r.error;
        errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
      }
    }
    for (const [err, count] of [...errorCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${count}x  ${err}`);
    }
  }

  // Per-repo breakdown
  console.log("\n--- By Repository ---");
  const repoStats = new Map<string, { total: number; patched: number }>();
  for (const r of results) {
    const repo = r.instance_id.split("__")[0]?.replace(/__/g, "/") || "unknown";
    const stats = repoStats.get(repo) || { total: 0, patched: 0 };
    stats.total++;
    if (r.success) stats.patched++;
    repoStats.set(repo, stats);
  }
  for (const [repo, stats] of [...repoStats.entries()].sort(
    (a, b) => b[1].total - a[1].total,
  )) {
    const pct = ((stats.patched / stats.total) * 100).toFixed(0);
    console.log(
      `  ${repo.padEnd(30)} ${stats.patched}/${stats.total} (${pct}%)`,
    );
  }

  // Slowest tasks
  console.log("\n--- Slowest Tasks ---");
  const sorted = [...results].sort((a, b) => b.duration_ms - a.duration_ms);
  for (const r of sorted.slice(0, 5)) {
    console.log(
      `  ${(r.duration_ms / 1000).toFixed(1)}s  ${r.instance_id}  ${r.success ? "PATCHED" : "NO_PATCH"}`,
    );
  }

  // Session IDs for further analysis
  const dataDir = process.env.SMC_DATA_DIR || join(process.env.HOME || "~", ".swe-bench-eval");
  console.log(`\n--- Run Logs ---`);
  console.log(`Session data: ${dataDir}/sessions/`);
  console.log(`View a session's run log:`);
  console.log(`  cat ${dataDir}/sessions/<session-id>/run-log.jsonl | head -20`);
}

main();
