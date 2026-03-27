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
// For Claude: writes {workDir}/CLAUDE.md
// For Codex:  writes {workDir}/AGENTS.md
func InjectRuntimeConfig(workDir, provider string, ctx TaskContextForEnv) error {
	content := buildMetaSkillContent(ctx)

	switch provider {
	case "claude":
		return os.WriteFile(filepath.Join(workDir, "CLAUDE.md"), []byte(content), 0o644)
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
	b.WriteString("You are responsible for managing the issue status throughout your work.\n\n")
	fmt.Fprintf(&b, "1. Run `multica issue get %s --output json` to understand your task\n", ctx.IssueID)
	fmt.Fprintf(&b, "2. Run `multica issue status %s in_progress`\n", ctx.IssueID)
	b.WriteString("3. Read comments for additional context or human instructions\n")
	b.WriteString("4. If the task requires code changes:\n")
	b.WriteString("   a. Create a new branch\n")
	b.WriteString("   b. Implement the changes and commit\n")
	b.WriteString("   c. Push the branch to the remote\n")
	b.WriteString("   d. Create a pull request (decide the target branch based on the repo's conventions)\n")
	fmt.Fprintf(&b, "   e. Post the PR link as a comment: `multica issue comment add %s --content \"PR: <url>\"`\n", ctx.IssueID)
	b.WriteString("5. If the task does not require code (e.g. research, documentation), post your findings as a comment\n")
	fmt.Fprintf(&b, "6. Run `multica issue status %s in_review`\n", ctx.IssueID)
	fmt.Fprintf(&b, "7. If blocked, run `multica issue status %s blocked` and post a comment explaining why\n\n", ctx.IssueID)

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
	b.WriteString("Keep comments concise and natural — state the outcome, not the process.\n")
	b.WriteString("Good: \"Fixed the login redirect. PR: https://...\"\n")
	b.WriteString("Bad: \"1. Read the issue 2. Found the bug in auth.go 3. Created branch 4. ...\"\n")

	return b.String()
}
