import type { AgentOptions } from "./types.js";
import { getModel } from "@mariozechner/pi-ai";
import { createCodingTools } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createExecTool } from "./tools/exec.js";
import { createProcessTool } from "./tools/process.js";
import { createGlobTool } from "./tools/glob.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/web/index.js";
import { createMemoryTools } from "./tools/memory/index.js";
import { filterTools } from "./tools/policy.js";

/**
 * Provider alias mapping for OAuth providers.
 * Maps friendly names to actual pi-ai provider names.
 */
const PROVIDER_ALIAS: Record<string, string> = {
  "claude-code": "anthropic", // Claude Code OAuth uses anthropic API
};

/**
 * Default models for each provider.
 */
const DEFAULT_MODELS: Record<string, string> = {
  "anthropic": "claude-sonnet-4-20250514",
  "claude-code": "claude-sonnet-4-20250514",
  "openai": "gpt-4o",
  "openai-codex": "gpt-5.1",
  "kimi-coding": "kimi-k2-thinking",
  "google": "gemini-2.0-flash",
  "groq": "llama-3.3-70b-versatile",
  "mistral": "mistral-large-latest",
};

export function resolveModel(options: AgentOptions) {
  if (options.provider && options.model) {
    // Map provider alias (e.g., claude-code -> anthropic)
    const actualProvider = PROVIDER_ALIAS[options.provider] ?? options.provider;

    // Type assertion needed because provider/model come from dynamic user config
    return (getModel as (p: string, m: string) => ReturnType<typeof getModel>)(
      actualProvider,
      options.model,
    );
  }

  // If only provider specified, use default model for that provider
  if (options.provider) {
    const actualProvider = PROVIDER_ALIAS[options.provider] ?? options.provider;
    const defaultModel = DEFAULT_MODELS[options.provider] ?? DEFAULT_MODELS[actualProvider];
    if (defaultModel) {
      return (getModel as (p: string, m: string) => ReturnType<typeof getModel>)(
        actualProvider,
        defaultModel,
      );
    }
  }

  return getModel("kimi-coding", "kimi-k2-thinking");
}

/** Options for creating tools */
export interface CreateToolsOptions {
  cwd: string;
  /** Profile ID for memory tools (optional) */
  profileId?: string;
  /** Base directory for profiles (optional) */
  profileBaseDir?: string;
}

/**
 * Create all available tools.
 * This returns the full set before policy filtering.
 */
export function createAllTools(options: CreateToolsOptions | string): AgentTool<any>[] {
  // Support legacy string argument for backwards compatibility
  const opts: CreateToolsOptions = typeof options === "string" ? { cwd: options } : options;
  const { cwd, profileId, profileBaseDir } = opts;

  const baseTools = createCodingTools(cwd).filter(
    (tool) => tool.name !== "bash",
  ) as AgentTool<any>[];

  const execTool = createExecTool(cwd);
  const processTool = createProcessTool(cwd);
  const globTool = createGlobTool(cwd);
  const webFetchTool = createWebFetchTool();
  const webSearchTool = createWebSearchTool();

  const tools: AgentTool<any>[] = [
    ...baseTools,
    execTool as AgentTool<any>,
    processTool as AgentTool<any>,
    globTool as AgentTool<any>,
    webFetchTool as AgentTool<any>,
    webSearchTool as AgentTool<any>,
  ];

  // Add memory tools if profileId is provided
  if (profileId) {
    const memoryTools = createMemoryTools({
      profileId,
      baseDir: profileBaseDir,
    });
    tools.push(...memoryTools);
  }

  return tools;
}

/**
 * Resolve tools for an agent with policy filtering.
 *
 * Applies 4-layer filtering:
 * 1. Profile (minimal/coding/web/full)
 * 2. Global allow/deny
 * 3. Provider-specific rules
 * 4. Subagent restrictions
 */
export function resolveTools(options: AgentOptions): AgentTool<any>[] {
  const cwd = options.cwd ?? process.cwd();

  // Create all tools (including memory tools if profileId is provided)
  const allTools = createAllTools({
    cwd,
    profileId: options.profileId,
    profileBaseDir: options.profileBaseDir,
  });

  // Apply policy filtering
  const filtered = filterTools(allTools, {
    config: options.tools,
    provider: options.provider,
    isSubagent: options.isSubagent,
  });

  return filtered;
}

/**
 * Get all available tool names (for debugging/listing).
 * Note: Memory tools require profileId, so they are not included by default.
 */
export function getAllToolNames(cwd?: string): string[] {
  const tools = createAllTools({ cwd: cwd ?? process.cwd() });
  return tools.map((t) => t.name);
}

/**
 * Get all available tool names including memory tools (for debugging/listing).
 */
export function getAllToolNamesWithMemory(cwd?: string, profileId?: string): string[] {
  const tools = createAllTools({
    cwd: cwd ?? process.cwd(),
    profileId: profileId ?? "test-profile",
  });
  return tools.map((t) => t.name);
}
