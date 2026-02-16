#!/usr/bin/env node

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === "--help" || args[0] === "-h") {
  console.error("Usage: node review-skill-security.mjs <skill-directory>");
  process.exit(1);
}

const targetDir = resolve(args[0]);
if (!existsSync(targetDir)) {
  console.error(JSON.stringify({
    targetDir,
    riskLevel: "dangerous",
    error: "Target directory does not exist",
  }, null, 2));
  process.exit(1);
}

/** Maximum file size to inspect as text (2 MB). */
const MAX_TEXT_FILE_BYTES = 2_000_000;
/** Maximum findings returned to avoid huge output. */
const MAX_FINDINGS = 200;

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
]);

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".php",
  ".lua",
  ".sql",
  ".xml",
  ".html",
  ".css",
]);

/**
 * @typedef {"safe" | "needs-review" | "dangerous"} RiskLevel
 */

/**
 * @typedef {{
 *   severity: Exclude<RiskLevel, "safe">;
 *   type: string;
 *   file: string;
 *   line?: number;
 *   message: string;
 *   snippet?: string;
 * }} Finding
 */

const LINE_PATTERNS = [
  {
    type: "network-pipe-shell",
    severity: "dangerous",
    regex: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba|z)?sh\b/i,
    message: "Network content piped directly into shell.",
  },
  {
    type: "powershell-iex-download",
    severity: "dangerous",
    regex: /\b(?:invoke-webrequest|iwr)\b[^\n|]*\|\s*iex\b/i,
    message: "Downloaded content executed via PowerShell IEX.",
  },
  {
    type: "destructive-rm-root",
    severity: "dangerous",
    regex: /(?:^|[\s;])(?:sudo\s+)?rm\s+-rf\s+(?:\/(?:\s|$)|~(?:\/|\s|$))/i,
    message: "Potentially destructive recursive delete at root/home scope.",
  },
  {
    type: "device-overwrite",
    severity: "dangerous",
    regex: /\bdd\s+if=.*\s+of=\/dev\/(?:sd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|disk\d+)/i,
    message: "Possible block-device overwrite command.",
  },
  {
    type: "reverse-shell",
    severity: "dangerous",
    regex: /\/dev\/tcp\/|nc\s+-e\s+|bash\s+-i\b.*\/dev\/tcp\//i,
    message: "Potential reverse-shell behavior.",
  },
  {
    type: "sudo-usage",
    severity: "needs-review",
    regex: /(^|[\s;])sudo\s+/i,
    message: "Uses privileged command execution (sudo).",
  },
  {
    type: "remote-download",
    severity: "needs-review",
    regex: /\b(?:curl|wget|invoke-webrequest|iwr)\b.*https?:\/\//i,
    message: "Downloads remote content. Verify source integrity and intent.",
  },
  {
    type: "dynamic-exec-js",
    severity: "needs-review",
    regex: /\bchild_process\.(?:exec|spawn|execSync|spawnSync)\b|\beval\s*\(/i,
    message: "Dynamic execution primitive found in JavaScript/TypeScript.",
  },
  {
    type: "python-shell-exec",
    severity: "needs-review",
    regex: /\bos\.system\s*\(|\bsubprocess\.(?:run|Popen|call)\s*\(.*shell\s*=\s*True/i,
    message: "Shell execution primitive found in Python.",
  },
  {
    type: "secret-env-access",
    severity: "needs-review",
    regex: /process\.env\.[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|\$\{?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\}?/i,
    message: "Reads variables that may contain credentials/secrets.",
  },
];

/**
 * @param {string} value
 * @returns {string}
 */
function compactSnippet(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function shouldReadAsText(filePath) {
  const base = basename(filePath).toLowerCase();
  if (base === "skill.md") return true;
  return TEXT_EXTENSIONS.has(extname(filePath).toLowerCase());
}

/**
 * @param {string} filePath
 * @returns {string | null}
 */
function readTextFile(filePath) {
  const buf = readFileSync(filePath);
  if (buf.includes(0)) return null;
  return buf.toString("utf-8");
}

/** @type {Finding[]} */
const findings = [];
let scannedFiles = 0;
let skippedLargeFiles = 0;
let skippedBinaryFiles = 0;
let symlinkCount = 0;

/**
 * @param {Finding} finding
 */
function addFinding(finding) {
  if (findings.length >= MAX_FINDINGS) return;
  findings.push(finding);
}

/**
 * @param {string} currentDir
 */
function walk(currentDir) {
  const entries = readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(currentDir, entry.name);
    const relPath = relative(targetDir, fullPath) || ".";

    let stat;
    try {
      stat = lstatSync(fullPath);
    } catch {
      addFinding({
        severity: "needs-review",
        type: "stat-error",
        file: relPath,
        message: "Could not stat path. Manual inspection recommended.",
      });
      continue;
    }

    if (stat.isSymbolicLink()) {
      symlinkCount++;
      addFinding({
        severity: "dangerous",
        type: "symlink",
        file: relPath,
        message: "Symbolic links can hide path traversal or redirection behavior.",
      });
      continue;
    }

    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(fullPath);
      continue;
    }

    if (!stat.isFile()) continue;
    scannedFiles++;

    if (stat.size > MAX_TEXT_FILE_BYTES) {
      skippedLargeFiles++;
      addFinding({
        severity: "needs-review",
        type: "large-file",
        file: relPath,
        message: `Large file (${stat.size} bytes) was not fully scanned.`,
      });
      continue;
    }

    if (!shouldReadAsText(fullPath)) continue;

    let content;
    try {
      content = readTextFile(fullPath);
    } catch {
      addFinding({
        severity: "needs-review",
        type: "read-error",
        file: relPath,
        message: "Failed to read file during scan.",
      });
      continue;
    }

    if (content === null) {
      skippedBinaryFiles++;
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (!line) continue;
      for (const pattern of LINE_PATTERNS) {
        if (!pattern.regex.test(line)) continue;
        addFinding({
          severity: pattern.severity,
          type: pattern.type,
          file: relPath,
          line: i + 1,
          message: pattern.message,
          snippet: compactSnippet(line),
        });
      }
    }
  }
}

walk(targetDir);

if (!existsSync(join(targetDir, "SKILL.md"))) {
  addFinding({
    severity: "dangerous",
    type: "missing-skill-md",
    file: ".",
    message: "SKILL.md not found at skill root.",
  });
}

const dangerousCount = findings.filter((f) => f.severity === "dangerous").length;
const reviewCount = findings.filter((f) => f.severity === "needs-review").length;

/** @type {RiskLevel} */
let riskLevel = "safe";
if (dangerousCount > 0) {
  riskLevel = "dangerous";
} else if (reviewCount > 0) {
  riskLevel = "needs-review";
}

const output = {
  targetDir,
  riskLevel,
  summary: {
    scannedFiles,
    symlinkCount,
    skippedLargeFiles,
    skippedBinaryFiles,
    dangerousFindings: dangerousCount,
    reviewFindings: reviewCount,
    totalFindings: findings.length,
    findingsTruncated: findings.length >= MAX_FINDINGS,
  },
  findings,
};

console.log(JSON.stringify(output, null, 2));
