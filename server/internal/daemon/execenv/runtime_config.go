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
// about the Multica runtime environment and available CLI tools.
func buildMetaSkillContent(ctx TaskContextForEnv) string {
	var b strings.Builder

	b.WriteString("# Multica Agent Runtime\n\n")
	b.WriteString("You are a coding agent in the Multica platform. Use the `multica` CLI to interact with the platform.\n\n")

	b.WriteString("## Available Commands\n\n")
	b.WriteString("### Read\n")
	b.WriteString("- `multica issue get <id>` — Get full issue details (title, description, status, priority, assignee)\n")
	b.WriteString("- `multica issue list [--status X] [--priority X] [--assignee X]` — List issues in workspace\n")
	b.WriteString("- `multica issue comment list <issue-id>` — List all comments on an issue\n")
	b.WriteString("- `multica workspace get` — Get workspace details and context\n")
	b.WriteString("- `multica agent list` — List agents in workspace\n\n")

	b.WriteString("### Write\n")
	b.WriteString("- `multica issue comment add <issue-id> --content \"...\"` — Post a comment to an issue\n")
	b.WriteString("- `multica issue status <id> <status>` — Update issue status (todo, in_progress, in_review, done, blocked)\n")
	b.WriteString("- `multica issue update <id> [--title X] [--description X] [--priority X]` — Update issue fields\n\n")

	b.WriteString("### Workflow\n")
	fmt.Fprintf(&b, "1. Run `multica issue get %s --output json` to understand your task\n", ctx.IssueID)
	b.WriteString("2. Read comments for additional context or human instructions\n")
	b.WriteString("3. Complete the work in the local codebase\n")
	b.WriteString("4. Post a comment summarizing what you did\n\n")

	if len(ctx.AgentSkills) > 0 {
		b.WriteString("## Skills\n\n")
		b.WriteString("Detailed skill instructions are in `.agent_context/skills/`. Each subdirectory contains a `SKILL.md`.\n\n")
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
	b.WriteString("When done, return a concise Markdown summary of your work.\n")
	b.WriteString("- Lead with the outcome.\n")
	b.WriteString("- Mention concrete files or commands if you changed anything.\n")
	b.WriteString("- If blocked, explain the blocker clearly.\n")

	return b.String()
}
