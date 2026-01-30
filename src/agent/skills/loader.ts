/**
 * Skills Loader
 *
 * Multi-source loading with precedence handling
 * Supports bundled skills, user-installed skills, profile skills, and plugin skills
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Skill, SkillSource, SkillManagerOptions } from "./types.js";
import { SKILL_FILE, SKILL_SOURCE_PRECEDENCE } from "./types.js";
import { parseSkillFile } from "./parser.js";
import { DATA_DIR } from "../../shared/index.js";
import { resolvePluginSkillDirs } from "./plugin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default profile base directory */
const DEFAULT_PROFILE_BASE_DIR = join(DATA_DIR, "agent-profiles");

/** Bundled skills directory (relative to package) */
const BUNDLED_DIR = join(__dirname, "../../../skills");

/** Managed skills directory (user-installed via `skills add`) */
const MANAGED_DIR = join(DATA_DIR, "skills");

/**
 * Discover skill directories in a given base path
 * A valid skill directory contains a SKILL.md file
 * Searches up to maxDepth levels deep
 *
 * @param baseDir - Base directory to search
 * @param maxDepth - Maximum depth to search (default: 3)
 * @returns Array of absolute paths to skill directories
 */
function discoverSkillDirs(baseDir: string, maxDepth: number = 3): string[] {
  if (!existsSync(baseDir)) {
    return [];
  }

  const results: string[] = [];

  function scan(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    try {
      const entries = readdirSync(dir);

      for (const name of entries) {
        // Skip hidden directories
        if (name.startsWith(".")) continue;

        const fullPath = join(dir, name);

        try {
          if (!statSync(fullPath).isDirectory()) continue;

          // Check if this directory has SKILL.md
          if (existsSync(join(fullPath, SKILL_FILE))) {
            results.push(fullPath);
          } else {
            // Recurse into subdirectory
            scan(fullPath, depth + 1);
          }
        } catch {
          // Skip inaccessible directories
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  scan(baseDir, 0);
  return results;
}

/**
 * Load all skills from a source directory
 *
 * @param baseDir - Base directory containing skill subdirectories
 * @param source - Source type for loaded skills
 * @returns Array of loaded skills
 */
function loadSkillsFromSource(baseDir: string, source: SkillSource): Skill[] {
  const skillDirs = discoverSkillDirs(baseDir);
  const skills: Skill[] = [];

  for (const dir of skillDirs) {
    const skillId = dir.split("/").pop();
    if (!skillId) continue;

    const filePath = join(dir, SKILL_FILE);
    const skill = parseSkillFile(filePath, skillId, source);
    if (skill) {
      skills.push(skill);
    }
  }

  return skills;
}

/**
 * Get profile skills directory path
 *
 * @param profileId - Agent profile ID
 * @param profileBaseDir - Profile base directory
 * @returns Path to profile skills directory
 */
export function getProfileSkillsDir(profileId: string, profileBaseDir?: string): string {
  const baseDir = profileBaseDir ?? DEFAULT_PROFILE_BASE_DIR;
  return join(baseDir, profileId, "skills");
}

/**
 * Load all skills from all sources, applying precedence
 * Higher precedence sources override skills with the same ID
 *
 * Loading order (lowest to highest precedence):
 * 1. bundled - Package bundled skills
 * 2. extra - User-configured extra directories
 * 3. plugins - Skills from npm packages with multica.plugin.json
 * 4. managed - ~/.super-multica/skills/ (user-installed via `skills add`)
 * 5. profile - ~/.super-multica/agent-profiles/<profileId>/skills/
 *
 * @param options - Loader options
 * @returns Map of skill ID to Skill
 */
export function loadAllSkills(options: SkillManagerOptions = {}): Map<string, Skill> {
  const skillMap = new Map<string, Skill>();

  // Discover plugin skill directories
  const pluginSkillDirs = resolvePluginSkillDirs({
    workspaceDir: options.workspaceDir ?? process.cwd(),
    extraPaths: options.pluginPaths ?? [],
  });

  // Define sources in order of precedence (lowest first)
  const sources: Array<[string, SkillSource]> = [
    // Bundled skills (lowest precedence)
    [BUNDLED_DIR, "bundled"],
    // Extra directories (treated as bundled)
    ...(options.extraDirs ?? []).map((d): [string, SkillSource] => [d, "bundled"]),
    // Plugin skills (between extra and managed)
    ...pluginSkillDirs.map((d): [string, SkillSource] => [d, "bundled"]),
    // Managed skills (user-installed via `skills add`)
    [MANAGED_DIR, "profile"],
  ];

  // Add profile skills if profileId is provided (highest precedence)
  if (options.profileId) {
    const profileSkillsDir = getProfileSkillsDir(options.profileId, options.profileBaseDir);
    sources.push([profileSkillsDir, "profile"]);
  }

  for (const [dir, source] of sources) {
    const skills = loadSkillsFromSource(dir, source);
    for (const skill of skills) {
      const existing = skillMap.get(skill.id);
      // Higher precedence overwrites lower
      if (
        !existing ||
        SKILL_SOURCE_PRECEDENCE[source] > SKILL_SOURCE_PRECEDENCE[existing.source]
      ) {
        skillMap.set(skill.id, skill);
      }
    }
  }

  return skillMap;
}

/**
 * Get path to bundled skills directory
 */
export function getBundledSkillsDir(): string {
  return BUNDLED_DIR;
}
