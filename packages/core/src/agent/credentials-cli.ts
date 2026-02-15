#!/usr/bin/env node
/**
 * Credentials CLI
 *
 * Commands:
 *   init       Create credentials.json5
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { getCredentialsPath } from "./credentials.js";

type Command = "init" | "help";

function printUsage(): void {
  console.log("Usage: pnpm credentials:cli <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  init        Create credentials.json5 (empty template)");
  console.log("  help        Show this help");
  console.log("");
  console.log("Options:");
  console.log("  --force         Overwrite existing files");
  console.log("  --path          Override credentials path (SMC_CREDENTIALS_PATH)");
  console.log("");
  console.log("Skill-specific API keys are stored in .env files within each skill's directory.");
  console.log("Example: ~/.super-multica/skills/<skill-id>/.env");
  console.log("");
  console.log("Examples:");
  console.log("  pnpm credentials:cli init");
  console.log("  pnpm credentials:cli init --force");
}

function buildCoreTemplate(): string {
  return `{
  version: 1,
  llm: {
    // provider: "openai",
    providers: {
      // openai: { apiKey: "sk-...", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" }
    }
  },
  tools: {
    // brave: { apiKey: "brv-..." },
    // perplexity: { apiKey: "pplx-...", baseUrl: "https://api.perplexity.ai", model: "perplexity/sonar-pro" },
    // data: { apiKey: "your-financial-datasets-api-key" }
  }
}
`;
}

function parseArgs(argv: string[]) {
  const args = [...argv];
  let force = false;
  let pathOverride: string | undefined;
  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;
    if (arg === "--force" || arg === "-f") {
      force = true;
      continue;
    }
    if (arg === "--path") {
      pathOverride = args.shift();
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { command: "help" as Command, force, pathOverride };
    }
    positional.push(arg);
  }

  const command = (positional[0] || "help") as Command;
  return { command, force, pathOverride };
}

function cmdInit(force: boolean, pathOverride?: string): void {
  const path = pathOverride ?? getCredentialsPath();
  if (existsSync(path) && !force) {
    console.error(`Error: credentials file already exists at ${path}`);
    console.error("Use --force to overwrite.");
    process.exit(1);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buildCoreTemplate(), "utf8");
  chmodSync(path, 0o600);
  console.log(`Created: ${path}`);

  console.log("Edit this file to add your credentials.");
  console.log("Skill-specific API keys go in .env files within each skill's directory.");
}

async function main() {
  const { command, force, pathOverride } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "init":
      cmdInit(force, pathOverride);
      break;
    case "help":
    default:
      printUsage();
      break;
  }
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
