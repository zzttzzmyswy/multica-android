/**
 * Tools module - provides tool creation and policy-based filtering.
 */

// Tool implementations
export { createExecTool } from "./exec.js";
export { createProcessTool } from "./process.js";
export { createGlobTool } from "./glob.js";
export { createWebFetchTool, createWebSearchTool } from "./web/index.js";

// Tool groups and profiles
export {
  type ToolProfileId,
  TOOL_NAME_ALIASES,
  TOOL_GROUPS,
  TOOL_PROFILES,
  DEFAULT_SUBAGENT_TOOL_DENY,
  normalizeToolName,
  normalizeToolList,
  expandToolGroups,
  getProfilePolicy,
} from "./groups.js";

// Tool policy system
export {
  type ToolPolicy,
  type ToolsConfig,
  type FilterToolsOptions,
  isToolAllowed,
  filterToolsByPolicy,
  filterTools,
  getSubagentPolicy,
  wouldToolBeAllowed,
} from "./policy.js";
