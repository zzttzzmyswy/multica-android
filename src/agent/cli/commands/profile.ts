/**
 * Profile command - Manage agent profiles
 *
 * Usage:
 *   multica profile list              List all profiles
 *   multica profile new <id>          Create a new profile
 *   multica profile show <id>         Show profile contents
 *   multica profile edit <id>         Open profile in file manager
 *   multica profile delete <id>       Delete a profile
 */

import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  createAgentProfile,
  loadAgentProfile,
  getProfileDir,
  profileExists,
} from "../../profile/index.js";
import { DATA_DIR } from "../../../shared/index.js";
import { cyan, yellow, green, dim, red } from "../colors.js";

const PROFILES_DIR = join(DATA_DIR, "agent-profiles");

type Command = "new" | "list" | "show" | "edit" | "delete" | "help";

function printHelp() {
  console.log(`
${cyan("Usage:")} multica profile <command> [options]

${cyan("Commands:")}
  ${yellow("list")}                List all profiles
  ${yellow("new")} <id>            Create a new profile
  ${yellow("show")} <id>           Show profile contents
  ${yellow("edit")} <id>           Open profile directory in file manager
  ${yellow("delete")} <id>         Delete a profile
  ${yellow("help")}                Show this help

${cyan("Profile Structure:")}
  Each profile is a directory containing:
  - soul.md       Personality and constraints
  - identity.md   Name and role
  - tools.md      Tool usage instructions
  - memory.md     Persistent knowledge
  - bootstrap.md  Initial context

${cyan("Examples:")}
  ${dim("# Create a new profile")}
  multica profile new my-agent

  ${dim("# List all profiles")}
  multica profile list

  ${dim("# Use a profile")}
  multica chat --profile my-agent
`);
}

function cmdNew(profileId: string | undefined) {
  if (!profileId) {
    console.error("Error: Profile ID is required");
    console.error("Usage: multica profile new <id>");
    process.exit(1);
  }

  // Validate profile ID
  if (!/^[a-zA-Z0-9_-]+$/.test(profileId)) {
    console.error("Error: Profile ID can only contain letters, numbers, hyphens, and underscores");
    process.exit(1);
  }

  if (profileExists(profileId)) {
    console.error(`Error: Profile "${profileId}" already exists`);
    console.error(`Location: ${getProfileDir(profileId)}`);
    process.exit(1);
  }

  const profile = createAgentProfile(profileId);
  const dir = getProfileDir(profileId);

  console.log(`${green("Created profile:")} ${yellow(profile.id)}`);
  console.log(`${dim("Location:")} ${dir}`);
  console.log("");
  console.log("Files created:");
  console.log("  - soul.md       (personality and constraints)");
  console.log("  - identity.md   (name and role)");
  console.log("  - tools.md      (tool usage instructions)");
  console.log("  - memory.md     (persistent knowledge)");
  console.log("  - bootstrap.md  (initial context)");
  console.log("");
  console.log("Edit these files to customize your agent, then run:");
  console.log(`  multica chat --profile ${profileId}`);
}

function cmdList() {
  if (!existsSync(PROFILES_DIR)) {
    console.log("No profiles found.");
    console.log(`Create one with: multica profile new <id>`);
    return;
  }

  const entries = readdirSync(PROFILES_DIR, { withFileTypes: true });
  const profiles = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (profiles.length === 0) {
    console.log("No profiles found.");
    console.log(`Create one with: multica profile new <id>`);
    return;
  }

  console.log(`\n${cyan("Available profiles:")}\n`);
  for (const id of profiles) {
    const dir = getProfileDir(id);
    console.log(`  ${yellow(id)}`);
    console.log(`    ${dim(dir)}`);
  }
  console.log("");
  console.log(`${dim(`Total: ${profiles.length} profile(s)`)}`);
}

function cmdShow(profileId: string | undefined) {
  if (!profileId) {
    console.error("Error: Profile ID is required");
    console.error("Usage: multica profile show <id>");
    process.exit(1);
  }

  const profile = loadAgentProfile(profileId);
  if (!profile) {
    console.error(`Error: Profile "${profileId}" not found`);
    console.error(`Create it with: multica profile new ${profileId}`);
    process.exit(1);
  }

  console.log(`\n${cyan("Profile:")} ${yellow(profile.id)}`);
  console.log(`${dim("Location:")} ${getProfileDir(profileId)}`);
  console.log("");

  if (profile.identity) {
    console.log(`${green("=== identity.md ===")}`);
    console.log(profile.identity.trim());
    console.log("");
  }

  if (profile.soul) {
    console.log(`${green("=== soul.md ===")}`);
    console.log(profile.soul.trim());
    console.log("");
  }

  if (profile.tools) {
    console.log(`${green("=== tools.md ===")}`);
    console.log(profile.tools.trim());
    console.log("");
  }

  if (profile.memory) {
    console.log(`${green("=== memory.md ===")}`);
    console.log(profile.memory.trim());
    console.log("");
  }

  if (profile.bootstrap) {
    console.log(`${green("=== bootstrap.md ===")}`);
    console.log(profile.bootstrap.trim());
    console.log("");
  }
}

async function cmdEdit(profileId: string | undefined) {
  if (!profileId) {
    console.error("Error: Profile ID is required");
    console.error("Usage: multica profile edit <id>");
    process.exit(1);
  }

  if (!profileExists(profileId)) {
    console.error(`Error: Profile "${profileId}" not found`);
    console.error(`Create it with: multica profile new ${profileId}`);
    process.exit(1);
  }

  const dir = getProfileDir(profileId);
  const { spawn } = await import("node:child_process");

  // Open in default file manager
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [dir], { detached: true, stdio: "ignore" }).unref();

  console.log(`${green("Opened:")} ${dir}`);
}

function cmdDelete(profileId: string | undefined) {
  if (!profileId) {
    console.error("Error: Profile ID is required");
    console.error("Usage: multica profile delete <id>");
    process.exit(1);
  }

  if (!profileExists(profileId)) {
    console.error(`Error: Profile "${profileId}" not found`);
    process.exit(1);
  }

  const dir = getProfileDir(profileId);

  try {
    rmSync(dir, { recursive: true });
    console.log(`${green("Deleted:")} ${profileId}`);
  } catch (err) {
    console.error(`${red("Error:")} Failed to delete profile: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

export async function profileCommand(args: string[]): Promise<void> {
  const command = (args[0] || "help") as Command;
  const arg1 = args[1];

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  switch (command) {
    case "new":
      cmdNew(arg1);
      break;
    case "list":
      cmdList();
      break;
    case "show":
      cmdShow(arg1);
      break;
    case "edit":
      await cmdEdit(arg1);
      break;
    case "delete":
      cmdDelete(arg1);
      break;
    case "help":
    default:
      printHelp();
      break;
  }
}
