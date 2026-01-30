/**
 * Plugin System
 *
 * Discovers and loads skills from npm packages that contain a multica.plugin.json manifest.
 * This enables users to install skill packages via npm and have them automatically discovered.
 *
 * Design inspired by OpenClaw's plugin system.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

// ============================================================================
// Types
// ============================================================================

/**
 * Plugin manifest file name
 */
export const PLUGIN_MANIFEST_FILENAME = "multica.plugin.json";

/**
 * Plugin manifest schema
 * Stored in multica.plugin.json at the package root
 */
export interface PluginManifest {
  /** Unique plugin identifier (required) */
  id: string;
  /** Human-readable plugin name */
  name?: string | undefined;
  /** Plugin description */
  description?: string | undefined;
  /** Plugin version */
  version?: string | undefined;
  /** Relative paths to skill directories within the package */
  skills?: string[] | undefined;
}

/**
 * Loaded plugin record with resolved paths
 */
export interface PluginRecord {
  /** Plugin ID from manifest */
  id: string;
  /** Plugin name */
  name?: string | undefined;
  /** Plugin description */
  description?: string | undefined;
  /** Plugin version */
  version?: string | undefined;
  /** Absolute path to package root */
  rootDir: string;
  /** Absolute path to manifest file */
  manifestPath: string;
  /** Resolved absolute paths to skill directories */
  skillDirs: string[];
  /** Source of discovery */
  source: "node_modules" | "custom";
}

/**
 * Plugin discovery diagnostic
 */
export interface PluginDiagnostic {
  level: "error" | "warn" | "info";
  pluginId?: string | undefined;
  source: string;
  message: string;
}

/**
 * Plugin registry result
 */
export interface PluginRegistry {
  plugins: PluginRecord[];
  diagnostics: PluginDiagnostic[];
}

// ============================================================================
// Manifest Loading
// ============================================================================

/**
 * Check if a value is a plain object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Normalize a string array from unknown input
 */
function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

/**
 * Load and parse a plugin manifest from a directory
 *
 * @param rootDir - Package root directory
 * @returns Parsed manifest or error
 */
export function loadPluginManifest(
  rootDir: string,
): { ok: true; manifest: PluginManifest; manifestPath: string } | { ok: false; error: string; manifestPath: string } {
  const manifestPath = join(rootDir, PLUGIN_MANIFEST_FILENAME);

  if (!existsSync(manifestPath)) {
    return { ok: false, error: `manifest not found: ${manifestPath}`, manifestPath };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;
  } catch (err) {
    return {
      ok: false,
      error: `failed to parse manifest: ${String(err)}`,
      manifestPath,
    };
  }

  if (!isRecord(raw)) {
    return { ok: false, error: "manifest must be an object", manifestPath };
  }

  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) {
    return { ok: false, error: "manifest requires id field", manifestPath };
  }

  const manifest: PluginManifest = {
    id,
    name: typeof raw.name === "string" ? raw.name.trim() : undefined,
    description: typeof raw.description === "string" ? raw.description.trim() : undefined,
    version: typeof raw.version === "string" ? raw.version.trim() : undefined,
    skills: normalizeStringList(raw.skills),
  };

  return { ok: true, manifest, manifestPath };
}

// ============================================================================
// Plugin Discovery
// ============================================================================

/**
 * Find all node_modules directories to search
 * Walks up from workspaceDir to find all node_modules in the tree
 */
function findNodeModulesDirs(workspaceDir: string): string[] {
  const dirs: string[] = [];
  let current = resolve(workspaceDir);
  const root = dirname(current);

  while (current !== root) {
    const nodeModules = join(current, "node_modules");
    if (existsSync(nodeModules) && statSync(nodeModules).isDirectory()) {
      dirs.push(nodeModules);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirs;
}

/**
 * Discover plugin packages in a node_modules directory
 *
 * @param nodeModulesDir - Path to node_modules
 * @returns Array of package directories containing plugin manifests
 */
function discoverPluginsInNodeModules(nodeModulesDir: string): string[] {
  const candidates: string[] = [];

  try {
    const entries = readdirSync(nodeModulesDir);

    for (const entry of entries) {
      // Skip hidden and special directories
      if (entry.startsWith(".") || entry === "node_modules") continue;

      const entryPath = join(nodeModulesDir, entry);

      try {
        const stat = statSync(entryPath);
        if (!stat.isDirectory()) continue;

        // Handle scoped packages (@org/package)
        if (entry.startsWith("@")) {
          const scopedEntries = readdirSync(entryPath);
          for (const scopedEntry of scopedEntries) {
            if (scopedEntry.startsWith(".")) continue;
            const scopedPath = join(entryPath, scopedEntry);
            if (existsSync(join(scopedPath, PLUGIN_MANIFEST_FILENAME))) {
              candidates.push(scopedPath);
            }
          }
        } else {
          // Regular package
          if (existsSync(join(entryPath, PLUGIN_MANIFEST_FILENAME))) {
            candidates.push(entryPath);
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }
  } catch {
    // Skip inaccessible node_modules
  }

  return candidates;
}

/**
 * Build a plugin record from a manifest and candidate
 */
function buildPluginRecord(params: {
  manifest: PluginManifest;
  manifestPath: string;
  rootDir: string;
  source: "node_modules" | "custom";
}): PluginRecord {
  const { manifest, manifestPath, rootDir, source } = params;

  // Resolve skill directories
  const skillDirs: string[] = [];
  for (const skillPath of manifest.skills ?? []) {
    const resolved = resolve(rootDir, skillPath);
    if (existsSync(resolved)) {
      skillDirs.push(resolved);
    }
  }

  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    rootDir,
    manifestPath,
    skillDirs,
    source,
  };
}

// ============================================================================
// Plugin Registry
// ============================================================================

/**
 * Discover and load all plugins
 *
 * @param options - Discovery options
 * @returns Plugin registry with all discovered plugins
 */
export function loadPluginRegistry(options: {
  /** Workspace directory to start search from */
  workspaceDir?: string;
  /** Additional directories to search for plugins */
  extraPaths?: string[];
  /** Skip node_modules scanning */
  skipNodeModules?: boolean;
}): PluginRegistry {
  const { workspaceDir, extraPaths = [], skipNodeModules = false } = options;
  const plugins: PluginRecord[] = [];
  const diagnostics: PluginDiagnostic[] = [];
  const seenIds = new Set<string>();

  // Discover plugins in node_modules
  if (!skipNodeModules && workspaceDir) {
    const nodeModulesDirs = findNodeModulesDirs(workspaceDir);

    for (const nodeModulesDir of nodeModulesDirs) {
      const candidates = discoverPluginsInNodeModules(nodeModulesDir);

      for (const candidate of candidates) {
        const result = loadPluginManifest(candidate);

        if (!result.ok) {
          diagnostics.push({
            level: "error",
            source: result.manifestPath,
            message: result.error,
          });
          continue;
        }

        const { manifest, manifestPath } = result;

        if (seenIds.has(manifest.id)) {
          diagnostics.push({
            level: "warn",
            pluginId: manifest.id,
            source: manifestPath,
            message: `duplicate plugin id; earlier instance takes precedence`,
          });
          continue;
        }

        seenIds.add(manifest.id);
        plugins.push(
          buildPluginRecord({
            manifest,
            manifestPath,
            rootDir: candidate,
            source: "node_modules",
          }),
        );
      }
    }
  }

  // Load plugins from extra paths
  for (const extraPath of extraPaths) {
    if (!existsSync(extraPath)) {
      diagnostics.push({
        level: "warn",
        source: extraPath,
        message: "extra plugin path does not exist",
      });
      continue;
    }

    const result = loadPluginManifest(extraPath);

    if (!result.ok) {
      diagnostics.push({
        level: "error",
        source: result.manifestPath,
        message: result.error,
      });
      continue;
    }

    const { manifest, manifestPath } = result;

    if (seenIds.has(manifest.id)) {
      diagnostics.push({
        level: "warn",
        pluginId: manifest.id,
        source: manifestPath,
        message: `duplicate plugin id; earlier instance takes precedence`,
      });
      continue;
    }

    seenIds.add(manifest.id);
    plugins.push(
      buildPluginRecord({
        manifest,
        manifestPath,
        rootDir: extraPath,
        source: "custom",
      }),
    );
  }

  return { plugins, diagnostics };
}

// ============================================================================
// Skill Directory Resolution
// ============================================================================

/**
 * Get all skill directories from discovered plugins
 *
 * This function is the main integration point with SkillManager.
 * It discovers plugins and returns their skill directories.
 *
 * @param options - Discovery options
 * @returns Array of absolute paths to skill directories
 */
export function resolvePluginSkillDirs(options: {
  workspaceDir?: string;
  extraPaths?: string[];
}): string[] {
  const registry = loadPluginRegistry(options);
  const dirs: string[] = [];
  const seen = new Set<string>();

  for (const plugin of registry.plugins) {
    for (const skillDir of plugin.skillDirs) {
      if (!seen.has(skillDir)) {
        seen.add(skillDir);
        dirs.push(skillDir);
      }
    }
  }

  return dirs;
}

/**
 * Get plugin registry with diagnostics for CLI/debugging
 *
 * @param options - Discovery options
 * @returns Full registry with plugins and diagnostics
 */
export function getPluginRegistry(options: {
  workspaceDir?: string;
  extraPaths?: string[];
}): PluginRegistry {
  return loadPluginRegistry(options);
}
