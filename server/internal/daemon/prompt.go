package daemon

import (
	"fmt"
	"strings"
)

// BuildPrompt constructs the task prompt for an agent CLI.
// The prompt is intentionally minimal — it provides only the issue ID and
// instructs the agent to use the multica CLI to fetch details on demand.
// Skill instructions are injected via the runtime's native config mechanism
// (e.g., .claude/CLAUDE.md, AGENTS.md) by execenv.InjectRuntimeConfig.
func BuildPrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a local coding agent for a Multica workspace.\n\n")

	fmt.Fprintf(&b, "Your assigned issue ID is: %s\n\n", task.IssueID)

	b.WriteString("Use the `multica` CLI to fetch the issue details and any context you need:\n\n")
	fmt.Fprintf(&b, "  multica issue get %s --output json    # Full issue details\n", task.IssueID)
	fmt.Fprintf(&b, "  multica issue comment list %s         # Comments and discussion\n\n", task.IssueID)

	fmt.Fprintf(&b, "Start by running `multica issue get %s --output json` to understand your task, then complete it.\n", task.IssueID)

	return b.String()
}
