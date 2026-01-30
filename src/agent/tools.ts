import type { AgentOptions } from "./types.js";
import { getModel } from "@mariozechner/pi-ai";
import { createCodingTools } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createExecTool } from "./tools/exec.js";
import { createProcessTool } from "./tools/process.js";
import { createGlobTool } from "./tools/glob.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/web/index.js";
import { filterTools } from "./tools/policy.js";

export function resolveModel(options: AgentOptions) {
  if (options.provider && options.model) {
    // Type assertion needed because provider/model come from dynamic user config
    return (getModel as (p: string, m: string) => ReturnType<typeof getModel>)(
      options.provider,
      options.model,
    );
  }
  return getModel("kimi-coding", "kimi-k2-thinking");
}

/**
 * Create all available tools.
 * This returns the full set before policy filtering.
 */
export function createAllTools(cwd: string): AgentTool<any>[] {
  const baseTools = createCodingTools(cwd).filter(
    (tool) => tool.name !== "bash",
  ) as AgentTool<any>[];

  const execTool = createExecTool(cwd);
  const processTool = createProcessTool(cwd);
  const globTool = createGlobTool(cwd);
  const webFetchTool = createWebFetchTool();
  const webSearchTool = createWebSearchTool();

  return [
    ...baseTools,
    execTool as AgentTool<any>,
    processTool as AgentTool<any>,
    globTool as AgentTool<any>,
    webFetchTool as AgentTool<any>,
    webSearchTool as AgentTool<any>,
  ];
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

  // Create all tools
  const allTools = createAllTools(cwd);

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
 */
export function getAllToolNames(cwd?: string): string[] {
  const tools = createAllTools(cwd ?? process.cwd());
  return tools.map((t) => t.name);
}
