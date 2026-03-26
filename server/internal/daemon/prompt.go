package daemon

import (
	"fmt"
	"strings"
)

// BuildPrompt constructs the task prompt for an agent CLI.
// This is kept lean — only the issue summary and acceptance criteria.
// Detailed skill instructions are injected via the runtime's native config
// mechanism (e.g., .claude/CLAUDE.md, AGENTS.md) by execenv.InjectRuntimeConfig.
func BuildPrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a local coding agent for a Multica workspace.\n")
	b.WriteString("Complete the assigned issue using the local environment.\n\n")

	fmt.Fprintf(&b, "**Issue:** %s\n", task.Context.Issue.Title)
	fmt.Fprintf(&b, "**Agent:** %s\n\n", task.Context.Agent.Name)

	if task.Context.Issue.Description != "" {
		desc := task.Context.Issue.Description
		if len(desc) > 200 {
			desc = desc[:200] + "..."
		}
		fmt.Fprintf(&b, "**Summary:** %s\n\n", desc)
	}

	return b.String()
}
