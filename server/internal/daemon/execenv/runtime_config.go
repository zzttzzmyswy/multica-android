package execenv

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// InjectRuntimeConfig writes the meta skill content into the runtime-specific
// config file so the agent discovers .agent_context/ through its native mechanism.
//
// For Claude: writes {workDir}/.claude/CLAUDE.md
// For Codex:  writes {workDir}/AGENTS.md
func InjectRuntimeConfig(workDir, provider string, ctx TaskContextForEnv) error {
	content := buildMetaSkillContent(ctx)

	switch provider {
	case "claude":
		dir := filepath.Join(workDir, ".claude")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create .claude dir: %w", err)
		}
		return os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte(content), 0o644)
	case "codex":
		return os.WriteFile(filepath.Join(workDir, "AGENTS.md"), []byte(content), 0o644)
	default:
		// Unknown provider — skip config injection, prompt-only mode.
		return nil
	}
}

// buildMetaSkillContent generates the meta skill markdown that teaches the agent
// about the Multica runtime environment and where to find task context/skills.
func buildMetaSkillContent(ctx TaskContextForEnv) string {
	var b strings.Builder

	b.WriteString("# Multica Agent Runtime\n\n")
	b.WriteString("You are running as a coding agent in the Multica platform.\n")
	b.WriteString("Your task context and skill instructions are in the `.agent_context/` directory.\n\n")

	b.WriteString("## Getting Started\n\n")
	b.WriteString("1. Read `.agent_context/issue_context.md` for the full issue description, acceptance criteria, and context.\n")

	if len(ctx.AgentSkills) > 0 {
		b.WriteString("2. Read your skill files in `.agent_context/skills/` for detailed instructions on how to work.\n")
	}

	b.WriteString("\n")

	if len(ctx.AgentSkills) > 0 {
		b.WriteString("## Skills\n\n")
		b.WriteString("Each skill directory contains a `SKILL.md` with instructions and optionally supporting files.\n\n")
		for _, skill := range ctx.AgentSkills {
			dirName := sanitizeSkillName(skill.Name)
			fmt.Fprintf(&b, "- **%s** → `.agent_context/skills/%s/SKILL.md`", skill.Name, dirName)
			if len(skill.Files) > 0 {
				fmt.Fprintf(&b, " (+ %d supporting files)", len(skill.Files))
			}
			b.WriteString("\n")
		}
		b.WriteString("\n")
	}

	b.WriteString("## Output\n\n")
	b.WriteString("When done, return a concise Markdown comment suitable for posting back to the issue.\n")
	b.WriteString("- Lead with the outcome.\n")
	b.WriteString("- Mention concrete files or commands if you changed anything.\n")
	b.WriteString("- If blocked, explain the blocker clearly.\n")

	return b.String()
}
