#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * @typedef {{
 *   id: string;
 *   check: string;
 *   passed: boolean;
 *   detail?: string;
 * }} CheckResult
 */

/**
 * @typedef {{
 *   provider: string;
 *   caseId: string;
 *   status: string;
 *   sessionId: string;
 *   sessionDir: string;
 *   logFile: string;
 *   checks: CheckResult[];
 *   pass: boolean;
 * }} CaseAnalysis
 */

const manifestArg = process.argv[2];
if (!manifestArg || manifestArg === "--help" || manifestArg === "-h") {
  console.log("Usage: node scripts/e2e-skills-benchmark/analyze.mjs <manifest.tsv>");
  process.exit(0);
}

const manifestPath = resolve(manifestArg);
if (!existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  process.exit(1);
}

const CASE_RULES = {
  "case-01-install-caldav-calendar": {
    requiredCommandTokens: [
      ["clawhub", "search"],
      ["caldav"],
      ["clawhub", "install"],
      ["review-skill-security.mjs"],
    ],
  },
  "case-02-gap-discovery-homeassistant": {
    requiredCommandTokens: [
      ["clawhub", "search"],
      ["home", "assistant"],
      ["clawhub", "install"],
      ["review-skill-security.mjs"],
    ],
  },
  "case-03-install-update-codexmonitor": {
    requiredCommandTokens: [
      ["clawhub", "search"],
      ["codexmonitor"],
      ["clawhub", "install"],
      ["clawhub", "update"],
      ["review-skill-security.mjs"],
    ],
  },
};

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitLines(text) {
  return text.split(/\r?\n/).filter(Boolean);
}

/**
 * @param {string} command
 * @param {string[]} tokens
 * @returns {boolean}
 */
function commandHasTokens(command, tokens) {
  const lower = command.toLowerCase();
  return tokens.every((token) => lower.includes(token.toLowerCase()));
}

/**
 * @param {string} rawArgs
 * @returns {string}
 */
function extractCommand(rawArgs) {
  if (!rawArgs) return "";
  try {
    const parsed = JSON.parse(rawArgs);
    if (parsed && typeof parsed.command === "string") {
      return parsed.command;
    }
  } catch {
    // Fall through: args may be truncated JSON in run-log.
  }
  return rawArgs;
}

/**
 * @param {string} runLogPath
 */
function parseRunLog(runLogPath) {
  const lines = splitLines(readFileSync(runLogPath, "utf-8"));
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Ignore malformed lines but keep analysis alive.
    }
  }
  return events;
}

/**
 * @param {CaseAnalysis} analysis
 * @param {string} id
 * @param {string} check
 * @param {boolean} passed
 * @param {string} [detail]
 */
function addCheck(analysis, id, check, passed, detail) {
  analysis.checks.push({ id, check, passed, detail });
}

const rows = splitLines(readFileSync(manifestPath, "utf-8"));
if (rows.length <= 1) {
  console.error(`Manifest has no data rows: ${manifestPath}`);
  process.exit(1);
}

/** @type {CaseAnalysis[]} */
const analyses = [];

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (!row) continue;

  const cols = row.split("\t");
  if (cols.length < 11) continue;

  const provider = cols[1] ?? "";
  const caseId = cols[2] ?? "";
  const status = cols[3] ?? "";
  const sessionId = cols[4] ?? "";
  const sessionDir = cols[5] ?? "";
  const logFile = cols[6] ?? "";

  /** @type {CaseAnalysis} */
  const analysis = {
    provider,
    caseId,
    status,
    sessionId,
    sessionDir,
    logFile,
    checks: [],
    pass: false,
  };

  addCheck(
    analysis,
    "run-status",
    "runner status is success",
    status === "success",
    `status=${status}`,
  );

  if (!sessionDir) {
    addCheck(analysis, "session-dir", "session_dir exists in manifest", false, "missing session_dir");
    analyses.push(analysis);
    continue;
  }

  const runLogPath = join(sessionDir, "run-log.jsonl");
  addCheck(
    analysis,
    "run-log-file",
    "run-log.jsonl exists",
    existsSync(runLogPath),
    runLogPath,
  );

  if (!existsSync(runLogPath)) {
    analyses.push(analysis);
    continue;
  }

  const events = parseRunLog(runLogPath);
  const runStarts = events.filter((e) => e.event === "run_start");
  const runEnds = events.filter((e) => e.event === "run_end");
  const toolStarts = events.filter((e) => e.event === "tool_start");
  const toolEnds = events.filter((e) => e.event === "tool_end");
  const errorToolEnds = toolEnds.filter((e) => e.is_error === true);

  addCheck(analysis, "event-run-start", "has run_start", runStarts.length > 0, `count=${runStarts.length}`);
  addCheck(analysis, "event-run-end", "has run_end", runEnds.length > 0, `count=${runEnds.length}`);
  addCheck(
    analysis,
    "tool-pairing",
    "tool_start count matches tool_end count",
    toolStarts.length === toolEnds.length,
    `start=${toolStarts.length} end=${toolEnds.length}`,
  );

  const finalRunEnd = runEnds.at(-1);
  const runEndError = finalRunEnd?.error;
  addCheck(
    analysis,
    "run-end-error",
    "final run_end.error is null/empty",
    runEndError === null || runEndError === undefined || runEndError === "",
    `error=${String(runEndError)}`,
  );

  addCheck(
    analysis,
    "tool-errors",
    "no tool_end has is_error=true",
    errorToolEnds.length === 0,
    `error_tool_calls=${errorToolEnds.length}`,
  );

  const execCommands = toolStarts
    .filter((e) => e.tool === "exec")
    .map((e) => extractCommand(typeof e.args === "string" ? e.args : ""))
    .filter(Boolean);

  addCheck(
    analysis,
    "exec-usage",
    "at least one exec command was used",
    execCommands.length > 0,
    `exec_calls=${execCommands.length}`,
  );

  const rules = CASE_RULES[caseId];
  if (rules) {
    for (let r = 0; r < rules.requiredCommandTokens.length; r++) {
      const tokenList = rules.requiredCommandTokens[r];
      const passed = execCommands.some((cmd) => commandHasTokens(cmd, tokenList));
      addCheck(
        analysis,
        `cmd-${r + 1}`,
        `exec command contains tokens: ${tokenList.join(" + ")}`,
        passed,
      );
    }
  } else {
    addCheck(
      analysis,
      "case-rules",
      "case has rule set",
      false,
      `No rules defined for case_id=${caseId}`,
    );
  }

  analysis.pass = analysis.checks.every((c) => c.passed);
  analyses.push(analysis);
}

const passedCases = analyses.filter((a) => a.pass).length;
const failedCases = analyses.length - passedCases;

const output = {
  manifestPath,
  totalCases: analyses.length,
  passedCases,
  failedCases,
  results: analyses,
};

const outputPath = join(dirname(manifestPath), "analysis.json");
writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

for (const item of analyses) {
  const status = item.pass ? "PASS" : "FAIL";
  console.log(`[${status}] provider=${item.provider} case=${item.caseId} session=${item.sessionId || "N/A"}`);
  for (const check of item.checks) {
    const marker = check.passed ? "  [ok]  " : "  [bad] ";
    const detail = check.detail ? ` (${check.detail})` : "";
    console.log(`${marker}${check.check}${detail}`);
  }
}

console.log("");
console.log(`Analysis file: ${outputPath}`);
console.log(`Summary: pass=${passedCases} fail=${failedCases}`);

if (failedCases > 0) {
  process.exit(1);
}
