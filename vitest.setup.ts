/**
 * Vitest global setup — statically scans test files for internal mock violations.
 *
 * Rule: only mock third-party / external dependencies.
 * Internal modules (relative imports, @multica/* packages) must NOT be mocked.
 *
 * This runs once at startup and logs warnings for violations without
 * interfering with vitest's mock hoisting mechanism.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const INTERNAL_MOCK_PATTERN =
  /vi\.mock\(\s*["'](\.\/|\.\.\/|@multica\/)[^"']*["']/g;

function scanDirectory(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isDirectory() && entry !== "node_modules") {
        files.push(...scanDirectory(full));
      } else if (entry.endsWith(".test.ts")) {
        files.push(full);
      }
    }
  } catch {
    // ignore unreadable directories
  }
  return files;
}

function checkMockPolicy(): void {
  const srcDir = resolve(process.cwd(), "src");
  const testFiles = scanDirectory(srcDir);
  const violations: Array<{ file: string; line: number; match: string }> = [];

  for (const file of testFiles) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      INTERNAL_MOCK_PATTERN.lastIndex = 0;
      const match = INTERNAL_MOCK_PATTERN.exec(line);
      if (match) {
        violations.push({
          file: file.replace(process.cwd() + "/", ""),
          line: i + 1,
          match: match[0],
        });
      }
    }
  }

  if (violations.length > 0) {
    console.warn("\n[mock-policy] Internal module mock violations detected:");
    console.warn(
      "  Rule: Only mock third-party dependencies. See CLAUDE.md Testing Guidelines.\n",
    );
    for (const v of violations) {
      console.warn(`  ${v.file}:${v.line}`);
      console.warn(`    ${v.match}\n`);
    }
    console.warn(
      `  Total: ${violations.length} violation(s) in ${new Set(violations.map((v) => v.file)).size} file(s)\n`,
    );
  }
}

checkMockPolicy();
