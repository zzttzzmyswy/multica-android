/**
 * System Prompt Report — telemetry and diagnostics
 */

import type { SystemPromptReport } from "./types.js";

/**
 * Format a prompt report as a human-readable summary for debugging.
 */
export function formatPromptReport(report: SystemPromptReport): string {
  // Estimate tokens as chars/4 (same heuristic used by token estimation)
  const estimatedTokens = Math.ceil(report.totalChars / 4);

  const lines: string[] = [
    `System Prompt Report (mode: ${report.mode})`,
    `  Total: ${report.totalChars} chars, ${report.totalLines} lines (~${estimatedTokens} tokens)`,
    `  Tools: ${report.toolCount}`,
    `  Skills: ${report.skillsIncluded ? "yes" : "no"}`,
    `  Safety: ${report.safetyIncluded ? "yes" : "no"}`,
    "",
    "  Sections:",
  ];

  for (const section of report.sections) {
    const status = section.included ? "✓" : "—";
    let detail = `${section.chars} chars, ${section.lines} lines`;
    if (section.truncated && section.originalChars !== undefined) {
      detail += ` (truncated from ${section.originalChars} chars)`;
    }
    lines.push(`    ${status} ${section.name}: ${detail}`);
  }

  return lines.join("\n");
}
