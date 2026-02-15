/**
 * System Prompt Engineering — Public API
 */

export { buildSystemPrompt, buildSystemPromptWithReport } from "./builder.js";
export { collectRuntimeInfo, formatRuntimeLine } from "./runtime-info.js";
export { formatPromptReport } from "./report.js";
export { SAFETY_CONSTITUTION } from "./constitution.js";
export {
  DEFAULT_BOOTSTRAP_MAX_CHARS,
  DEFAULT_SKILLS_MAX_CHARS,
  truncateWithBudget,
} from "./sections.js";

export type {
  ChannelInfo,
  ProfileContent,
  PromptSection,
  RuntimeInfo,
  SectionReport,
  SubagentContext,
  SystemPromptMode,
  SystemPromptOptions,
  SystemPromptReport,
} from "./types.js";
