import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR, DEFAULT_WORKSPACE_DIR } from "@multica/utils";

/**
 * Resolve the workspace directory for a given profile.
 * Priority: env var > config > profile-based default
 */
export function resolveWorkspaceDir(options?: {
  profileId?: string;
  configWorkspaceDir?: string;
}): string {
  // 1. Env var override
  const envDir = process.env.MULTICA_WORKSPACE_DIR?.trim();
  if (envDir) return path.resolve(envDir.replace(/^~/, os.homedir()));

  // 2. Config override (from profile config.json)
  if (options?.configWorkspaceDir?.trim()) {
    return path.resolve(options.configWorkspaceDir.replace(/^~/, os.homedir()));
  }

  // 3. Profile-based default: ~/.super-multica/workspace/{profileId}
  const profileId = options?.profileId ?? "default";
  return path.join(DEFAULT_WORKSPACE_DIR, profileId);
}

/**
 * Ensure workspace directory exists. Creates README.md on first creation.
 */
export function ensureWorkspaceDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const readmePath = path.join(dir, "README.md");
  try {
    writeFileSync(readmePath, README_CONTENT, { encoding: "utf-8", flag: "wx" });
  } catch (err) {
    if ((err as { code?: string }).code !== "EEXIST") throw err;
  }
}

const README_CONTENT = `# Multica Workspace

This directory is the default workspace for your Multica agent.
Files created by the agent will be saved here unless you specify a different directory.
`;
