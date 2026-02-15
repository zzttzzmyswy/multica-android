/**
 * System Prompt Builder
 *
 * Core assembly logic: collects sections based on mode, filters, and joins.
 */

import type {
  PromptSection,
  SystemPromptOptions,
  SystemPromptReport,
} from "./types.js";
import {
  buildChannelsSection,
  buildHeartbeatSection,
  buildConditionalToolSections,
  buildExtraPromptSection,
  buildIdentitySection,
  buildMemoryFileSection,
  buildProfileDirSection,
  buildRuntimeSection,
  buildSafetySection,
  buildSkillsSection,
  buildSubagentSection,
  buildTimeAwarenessSection,
  buildToolCallStyleSection,
  buildToolingSummary,
  buildUserSection,
  buildWorkspaceSection,
  truncateWithBudget,
  DEFAULT_BOOTSTRAP_MAX_CHARS,
  DEFAULT_SKILLS_MAX_CHARS,
} from "./sections.js";

/**
 * Build a system prompt from structured options.
 */
export function buildSystemPrompt(options: SystemPromptOptions): string {
  const { prompt } = buildSystemPromptWithReport(options);
  return prompt;
}

/**
 * Build a system prompt and return a diagnostic report alongside it.
 */
export function buildSystemPromptWithReport(options: SystemPromptOptions): {
  prompt: string;
  report: SystemPromptReport;
} {
  const {
    mode,
    profile,
    profileDir,
    workspaceDir,
    tools,
    skillsPrompt,
    runtime,
    subagent,
    channels,
    extraSystemPrompt,
    includeSafety = true,
  } = options;

  // Pre-compute truncation info for budget-controlled sections
  const workspaceOriginalChars = profile?.workspace?.length ?? 0;
  const workspaceTruncated = workspaceOriginalChars > DEFAULT_BOOTSTRAP_MAX_CHARS;
  const skillsTrimmed = skillsPrompt?.trim() ?? "";
  const skillsOriginalChars = skillsTrimmed.length;
  const skillsTruncated = skillsOriginalChars > DEFAULT_SKILLS_MAX_CHARS;

  // Collect all candidate sections in order
  const candidates: Array<{ name: string; lines: string[]; truncated?: boolean; originalChars?: number }> = [
    { name: "identity", lines: buildIdentitySection(profile, mode) },
    { name: "user", lines: buildUserSection(profile, mode) },
    { name: "workspace", lines: buildWorkspaceSection(profile, mode, profileDir, workspaceDir),
      ...(workspaceTruncated ? { truncated: true, originalChars: workspaceOriginalChars } : {}),
    },
    { name: "memory", lines: buildMemoryFileSection(profile, mode) },
    { name: "heartbeat", lines: buildHeartbeatSection(profile, mode) },
    { name: "safety", lines: buildSafetySection(includeSafety) },
    { name: "tooling", lines: buildToolingSummary(tools, mode) },
    { name: "tool-call-style", lines: buildToolCallStyleSection(mode) },
    { name: "conditional-tools", lines: buildConditionalToolSections(tools, mode) },
    { name: "skills", lines: buildSkillsSection(skillsPrompt, mode),
      ...(skillsTruncated ? { truncated: true, originalChars: skillsOriginalChars } : {}),
    },
    { name: "runtime", lines: buildRuntimeSection(runtime, mode) },
    { name: "time-awareness", lines: buildTimeAwarenessSection(tools, mode) },
    { name: "profile-dir", lines: buildProfileDirSection(profileDir, mode) },
    { name: "channels", lines: buildChannelsSection(channels, mode) },
    { name: "subagent", lines: buildSubagentSection(subagent, mode) },
    { name: "extra", lines: buildExtraPromptSection(extraSystemPrompt, mode) },
  ];

  // Build included sections
  const sections: PromptSection[] = [];
  const reportSections: SystemPromptReport["sections"] = [];

  for (const { name, lines, truncated, originalChars } of candidates) {
    const included = lines.length > 0;
    const content = lines.join("\n");
    reportSections.push({
      name,
      chars: content.length,
      lines: included ? content.split("\n").length : 0,
      included,
      ...(truncated && included ? { truncated: true, originalChars } : {}),
    });
    if (included) {
      sections.push({ name, content });
    }
  }

  // Join sections with double newline separators
  const prompt = sections.map((s) => s.content).join("\n\n");

  const report: SystemPromptReport = {
    mode,
    totalChars: prompt.length,
    totalLines: prompt.split("\n").length,
    sections: reportSections,
    toolCount: tools?.length ?? 0,
    skillsIncluded: (skillsPrompt?.trim()?.length ?? 0) > 0 && mode === "full",
    safetyIncluded: includeSafety,
  };

  return { prompt, report };
}
