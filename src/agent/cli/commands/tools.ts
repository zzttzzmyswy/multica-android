/**
 * Tools command - Inspect and test tool policies
 *
 * Usage:
 *   multica tools list [options]     List available tools
 *   multica tools groups             Show all tool groups
 *   multica tools profiles           Show all tool profiles
 */

import { createAllTools } from "../../tools.js";
import { filterTools, type ToolsConfig } from "../../tools/policy.js";
import { TOOL_GROUPS, TOOL_PROFILES, expandToolGroups } from "../../tools/groups.js";
import { cyan, yellow, green, dim } from "../colors.js";

type Command = "list" | "groups" | "profiles" | "help";

interface ToolsOptions {
  command: Command;
  profile?: string;
  allow?: string[];
  deny?: string[];
  provider?: string;
  isSubagent?: boolean;
}

function printHelp() {
  console.log(`
${cyan("Usage:")} multica tools <command> [options]

${cyan("Commands:")}
  ${yellow("list")}                List available tools (with optional filtering)
  ${yellow("groups")}              Show all tool groups
  ${yellow("profiles")}            Show all tool profiles
  ${yellow("help")}                Show this help

${cyan("Options for 'list':")}
  ${yellow("--profile")} PROFILE   Apply profile filter (minimal, coding, web, full)
  ${yellow("--allow")} TOOLS       Allow specific tools (comma-separated)
  ${yellow("--deny")} TOOLS        Deny specific tools (comma-separated)
  ${yellow("--provider")} NAME     Apply provider-specific rules
  ${yellow("--subagent")}          Apply subagent restrictions

${cyan("Examples:")}
  ${dim("# List all tools")}
  multica tools list

  ${dim("# List tools with profile")}
  multica tools list --profile coding

  ${dim("# List tools with allow/deny")}
  multica tools list --profile coding --deny exec
  multica tools list --allow group:fs,web_fetch

  ${dim("# Show tool groups")}
  multica tools groups
`);
}

function parseArgs(argv: string[]): ToolsOptions {
  const args = [...argv];
  const command = (args.shift() || "help") as Command;

  if (command === "--help" || command === "-h") {
    return { command: "help" };
  }

  const opts: ToolsOptions = { command };

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    if (arg === "--help" || arg === "-h") {
      return { command: "help" };
    }
    if (arg === "--profile") {
      opts.profile = args.shift();
      continue;
    }
    if (arg === "--allow") {
      const value = args.shift();
      opts.allow = value?.split(",").map((s) => s.trim()) ?? [];
      continue;
    }
    if (arg === "--deny") {
      const value = args.shift();
      opts.deny = value?.split(",").map((s) => s.trim()) ?? [];
      continue;
    }
    if (arg === "--provider") {
      opts.provider = args.shift();
      continue;
    }
    if (arg === "--subagent") {
      opts.isSubagent = true;
      continue;
    }
  }

  return opts;
}

function cmdList(opts: ToolsOptions) {
  const allTools = createAllTools(process.cwd());

  console.log(`\n${cyan("Tools Overview")}`);
  console.log(`Total tools available: ${allTools.length}\n`);

  // Build config
  let config: ToolsConfig | undefined;
  if (opts.profile || opts.allow || opts.deny) {
    config = {};
    if (opts.profile) {
      config.profile = opts.profile as ToolsConfig["profile"];
    }
    if (opts.allow) {
      config.allow = opts.allow;
    }
    if (opts.deny) {
      config.deny = opts.deny;
    }
  }

  const filterOpts: import("../../tools/policy.js").FilterToolsOptions = {};
  if (config) {
    filterOpts.config = config;
  }
  if (opts.provider) {
    filterOpts.provider = opts.provider;
  }
  if (opts.isSubagent) {
    filterOpts.isSubagent = opts.isSubagent;
  }

  const filtered = filterTools(allTools, filterOpts);

  if (config || opts.provider || opts.isSubagent) {
    console.log("Applied filters:");
    if (opts.profile) console.log(`  ${dim("Profile:")} ${yellow(opts.profile)}`);
    if (opts.allow) console.log(`  ${dim("Allow:")} ${opts.allow.join(", ")}`);
    if (opts.deny) console.log(`  ${dim("Deny:")} ${opts.deny.join(", ")}`);
    if (opts.provider) console.log(`  ${dim("Provider:")} ${opts.provider}`);
    if (opts.isSubagent) console.log(`  ${dim("Subagent:")} true`);
    console.log("");
    console.log(`Tools after filtering: ${green(String(filtered.length))}`);
    console.log("");
  }

  console.log("Tools:");
  for (const tool of filtered) {
    const desc = tool.description?.slice(0, 55) || "";
    console.log(`  ${yellow(tool.name.padEnd(15))} ${dim(desc)}${desc.length >= 55 ? "..." : ""}`);
  }

  if (filtered.length < allTools.length) {
    const removed = allTools.filter((t) => !filtered.find((f) => f.name === t.name));
    console.log("");
    console.log(`${dim(`Filtered out (${removed.length}):`)}`);
    for (const tool of removed) {
      console.log(`  ${dim(tool.name)}`);
    }
  }
}

function cmdGroups() {
  console.log(`\n${cyan("Tool Groups:")}\n`);
  for (const [name, tools] of Object.entries(TOOL_GROUPS)) {
    console.log(`  ${yellow(name)}:`);
    console.log(`    ${dim(tools.join(", "))}`);
    console.log("");
  }
}

function cmdProfiles() {
  console.log(`\n${cyan("Tool Profiles:")}\n`);
  for (const [name, policy] of Object.entries(TOOL_PROFILES)) {
    console.log(`  ${yellow(name)}:`);
    if (policy.allow) {
      const expanded = expandToolGroups(policy.allow);
      console.log(`    ${dim("Allow:")} ${policy.allow.join(", ")}`);
      console.log(`    ${dim("Expands to:")} ${expanded.join(", ")}`);
    } else {
      console.log(`    ${dim("Allow:")} (all tools)`);
    }
    if (policy.deny) {
      console.log(`    ${dim("Deny:")} ${policy.deny.join(", ")}`);
    }
    console.log("");
  }
}

export async function toolsCommand(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  switch (opts.command) {
    case "list":
      cmdList(opts);
      break;
    case "groups":
      cmdGroups();
      break;
    case "profiles":
      cmdProfiles();
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}
