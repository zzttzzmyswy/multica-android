/**
 * Skill Eligibility Checker
 *
 * Filter skills based on platform, binaries, environment, and configuration
 * Compatible with OpenClaw eligibility rules
 */

import { execSync } from "node:child_process";
import type {
  Skill,
  SkillsConfig,
  EligibilityResult,
} from "./types.js";
import {
  getSkillKey,
  getSkillConfig,
  normalizeRequirements,
  normalizePlatforms,
} from "./types.js";

// ============================================================================
// Binary and Environment Checks
// ============================================================================

/**
 * Check if a binary exists in PATH
 *
 * @param binary - Binary name to check
 * @returns True if binary exists
 */
export function binaryExists(binary: string): boolean {
  try {
    // Use 'which' on Unix, 'where' on Windows
    const cmd = process.platform === "win32" ? `where ${binary}` : `which ${binary}`;
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if an environment variable is set
 *
 * @param envVar - Environment variable name
 * @returns True if set (even if empty string)
 */
function envExists(envVar: string): boolean {
  return envVar in process.env;
}

// ============================================================================
// Config Path Resolution
// ============================================================================

/**
 * Resolve a dot-separated config path
 *
 * @param config - Config object
 * @param pathStr - Dot-separated path (e.g., "browser.enabled")
 * @returns The value at the path, or undefined
 */
export function resolveConfigPath(
  config: Record<string, unknown> | undefined,
  pathStr: string,
): unknown {
  if (!config) return undefined;

  const parts = pathStr.split(".").filter(Boolean);
  let current: unknown = config;

  for (const part of parts) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Check if a config path is truthy
 *
 * @param config - Config object
 * @param pathStr - Dot-separated path
 * @returns True if the value at path is truthy
 */
export function isConfigPathTruthy(
  config: Record<string, unknown> | undefined,
  pathStr: string,
): boolean {
  const value = resolveConfigPath(config, pathStr);
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

// ============================================================================
// Bundled Skills Allowlist
// ============================================================================

const BUNDLED_SOURCES = new Set(["bundled"]);

/**
 * Check if a skill is from bundled source
 */
function isBundledSkill(skill: Skill): boolean {
  return BUNDLED_SOURCES.has(skill.source);
}

/**
 * Check if a bundled skill is allowed by the allowlist
 *
 * @param skill - Skill to check
 * @param allowlist - List of allowed skill keys (undefined = allow all)
 * @returns True if allowed
 */
function isBundledSkillAllowed(skill: Skill, allowlist?: string[]): boolean {
  // No allowlist = allow all
  if (!allowlist || allowlist.length === 0) return true;
  // Non-bundled skills are always allowed
  if (!isBundledSkill(skill)) return true;
  // Check if skill key or id is in allowlist
  const key = getSkillKey(skill);
  return allowlist.includes(key) || allowlist.includes(skill.id);
}

// ============================================================================
// Main Eligibility Check
// ============================================================================

export interface EligibilityContext {
  /** Skills configuration */
  config?: SkillsConfig | undefined;
  /** Platform to check against (defaults to current) */
  platform?: NodeJS.Platform | undefined;
  /** Custom config object for config path checks */
  customConfig?: Record<string, unknown> | undefined;
}

/**
 * Check if a skill is eligible based on its requirements and configuration
 *
 * Eligibility rules (in order):
 * 1. If explicitly disabled in config → not eligible
 * 2. If bundled and not in allowlist → not eligible
 * 3. If platform not supported → not eligible
 * 4. If metadata.always is true → eligible (skip remaining checks)
 * 5. All required binaries must exist
 * 6. At least one of anyBins must exist (if specified)
 * 7. All required env vars must be set (or provided via config)
 * 8. All required config paths must be truthy
 *
 * @param skill - Skill to check
 * @param context - Eligibility context
 * @returns Eligibility result with reasons if ineligible
 */
export function checkEligibility(
  skill: Skill,
  context: EligibilityContext = {},
): EligibilityResult {
  const { config, platform = process.platform, customConfig } = context;
  const reasons: string[] = [];
  const metadata = skill.frontmatter.metadata;
  const skillConfig = getSkillConfig(skill, config);

  // 1. Check if explicitly disabled in config
  if (skillConfig?.enabled === false) {
    return {
      eligible: false,
      reasons: [`Skill disabled in configuration`],
    };
  }

  // 2. Check bundled allowlist
  if (!isBundledSkillAllowed(skill, config?.allowBundled)) {
    return {
      eligible: false,
      reasons: [`Bundled skill not in allowlist`],
    };
  }

  // 3. Platform check
  const platforms = normalizePlatforms(metadata);
  if (platforms.length > 0 && !platforms.includes(platform)) {
    reasons.push(
      `Platform '${platform}' not supported (requires: ${platforms.join(", ")})`,
    );
  }

  // Early return if platform check failed
  if (reasons.length > 0) {
    return { eligible: false, reasons };
  }

  // 4. Always flag - skip remaining checks
  if (metadata?.always === true) {
    return { eligible: true };
  }

  // Get normalized requirements
  const requirements = normalizeRequirements(metadata);

  // 5. Required binaries check (all must exist)
  if (requirements.bins && requirements.bins.length > 0) {
    for (const bin of requirements.bins) {
      if (!binaryExists(bin)) {
        reasons.push(`Required binary not found: ${bin}`);
      }
    }
  }

  // 6. Any binaries check (at least one must exist)
  if (requirements.anyBins && requirements.anyBins.length > 0) {
    const anyFound = requirements.anyBins.some((bin) => binaryExists(bin));
    if (!anyFound) {
      reasons.push(
        `None of required binaries found: ${requirements.anyBins.join(", ")}`,
      );
    }
  }

  // 7. Environment variable check
  if (requirements.env && requirements.env.length > 0) {
    for (const envVar of requirements.env) {
      // Check if env var exists
      if (envExists(envVar)) continue;

      // Check if provided via skill config env
      if (skillConfig?.env?.[envVar]) continue;

      // Check if provided via apiKey + primaryEnv match
      if (skillConfig?.apiKey && metadata?.primaryEnv === envVar) continue;

      reasons.push(`Required environment variable not set: ${envVar}`);
    }
  }

  // 8. Config path check
  if (requirements.config && requirements.config.length > 0) {
    for (const configPath of requirements.config) {
      if (!isConfigPathTruthy(customConfig, configPath)) {
        reasons.push(`Required config path not truthy: ${configPath}`);
      }
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons: reasons.length > 0 ? reasons : undefined,
  };
}

/**
 * Filter skills by eligibility
 *
 * @param skills - Map of skills to filter
 * @param context - Eligibility context
 * @returns Map containing only eligible skills
 */
export function filterEligibleSkills(
  skills: Map<string, Skill>,
  context: EligibilityContext = {},
): Map<string, Skill> {
  const eligible = new Map<string, Skill>();

  for (const [id, skill] of skills) {
    const result = checkEligibility(skill, context);
    if (result.eligible) {
      eligible.set(id, skill);
    }
  }

  return eligible;
}

// ============================================================================
// Legacy Compatibility
// ============================================================================

/**
 * @deprecated Use checkEligibility with context instead
 */
export function checkEligibilityLegacy(
  skill: Skill,
  platform: NodeJS.Platform = process.platform,
): EligibilityResult {
  return checkEligibility(skill, { platform });
}
