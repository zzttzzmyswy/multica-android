/**
 * Credentials command - Manage credentials and environment files
 *
 * Usage:
 *   multica credentials init          Create credential files
 *   multica credentials show          Show credential paths
 *   multica credentials edit          Open credentials in editor
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { getCredentialsPath } from "@multica/core";
import { cyan, yellow, green, dim, red } from "../colors.js";

type Command = "init" | "show" | "edit" | "help";

interface CredentialsOptions {
  command: Command;
  force: boolean;
  pathOverride?: string | undefined;
}

function printHelp() {
  console.log(`
${cyan("Usage:")} multica credentials <command> [options]

${cyan("Commands:")}
  ${yellow("init")}                Create credentials.json5
  ${yellow("show")}                Show credential file paths
  ${yellow("edit")}                Open credentials directory in file manager
  ${yellow("help")}                Show this help

${cyan("Options for 'init':")}
  ${yellow("--force")}             Overwrite existing files
  ${yellow("--path")} PATH         Override credentials path

${cyan("Files Created:")}
  ~/.super-multica/credentials.json5     LLM providers + tools config

${dim("Skill-specific API keys are stored in .env files within each skill's directory.")}
${dim("Example: ~/.super-multica/skills/<skill-id>/.env")}

${cyan("Examples:")}
  ${dim("# Initialize credentials")}
  multica credentials init

  ${dim("# Force overwrite")}
  multica credentials init --force
`);
}

function parseArgs(argv: string[]): CredentialsOptions {
  const args = [...argv];
  const opts: CredentialsOptions = {
    command: "help",
    force: false,
  };

  const positional: string[] = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    if (arg === "--help" || arg === "-h") {
      opts.command = "help";
      return opts;
    }
    if (arg === "--force" || arg === "-f") {
      opts.force = true;
      continue;
    }
    if (arg === "--path") {
      opts.pathOverride = args.shift();
      continue;
    }
    positional.push(arg);
  }

  opts.command = (positional[0] || "help") as Command;
  return opts;
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
    // perplexity: { apiKey: "pplx-...", baseUrl: "https://api.perplexity.ai", model: "perplexity/sonar-pro" }
  }
}
`;
}

function cmdInit(opts: CredentialsOptions): void {
  const path = opts.pathOverride ?? getCredentialsPath();
  if (existsSync(path) && !opts.force) {
    console.error(`${red("Error:")} Credentials file already exists at ${path}`);
    console.error("Use --force to overwrite.");
    process.exit(1);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buildCoreTemplate(), "utf8");
  chmodSync(path, 0o600);
  console.log(`${green("Created:")} ${path}`);

  console.log("");
  console.log("Edit this file to add your LLM provider credentials.");
  console.log(`${dim("Skill-specific API keys go in .env files within each skill's directory.")}`);
}

function cmdShow(): void {
  const credentialsPath = getCredentialsPath();

  console.log(`\n${cyan("Credential Files:")}\n`);

  console.log(`${yellow("credentials.json5")}`);
  console.log(`  Path: ${credentialsPath}`);
  console.log(`  Exists: ${existsSync(credentialsPath) ? green("Yes") : red("No")}`);
  console.log("");

  console.log(`${dim("Skill-specific API keys are stored in .env files within each skill's directory.")}`);
  console.log("");

  if (!existsSync(credentialsPath)) {
    console.log(`${dim("Run 'multica credentials init' to create missing files.")}`);
  }
}

async function cmdEdit(): Promise<void> {
  const credentialsPath = getCredentialsPath();
  const dir = dirname(credentialsPath);

  if (!existsSync(dir)) {
    console.error(`${red("Error:")} Credentials directory does not exist: ${dir}`);
    console.error("Run 'multica credentials init' first.");
    process.exit(1);
  }

  const { spawn } = await import("node:child_process");

  // Open in default file manager
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();

  console.log(`${green("Opened:")} ${dir}`);
}

export async function credentialsCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  switch (opts.command) {
    case "init":
      cmdInit(opts);
      break;
    case "show":
      cmdShow();
      break;
    case "edit":
      await cmdEdit();
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}
