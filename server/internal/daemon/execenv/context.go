package execenv

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// writeContextFiles renders and writes .agent_context/issue_context.md and skills into workDir.
func writeContextFiles(workDir string, ctx TaskContextForEnv) error {
	contextDir := filepath.Join(workDir, ".agent_context")
	if err := os.MkdirAll(contextDir, 0o755); err != nil {
		return fmt.Errorf("create .agent_context dir: %w", err)
	}

	content := renderIssueContext(ctx)
	path := filepath.Join(contextDir, "issue_context.md")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return fmt.Errorf("write issue_context.md: %w", err)
	}

	if len(ctx.AgentSkills) > 0 {
		if err := writeSkillFiles(contextDir, ctx.AgentSkills); err != nil {
			return fmt.Errorf("write skill files: %w", err)
		}
	}

	return nil
}

var nonAlphaNum = regexp.MustCompile(`[^a-z0-9]+`)

// sanitizeSkillName converts a skill name to a safe directory name.
func sanitizeSkillName(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = nonAlphaNum.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "skill"
	}
	return s
}

// writeSkillFiles creates a skills/ directory with one subdirectory per skill.
func writeSkillFiles(contextDir string, skills []SkillContextForEnv) error {
	skillsDir := filepath.Join(contextDir, "skills")
	if err := os.MkdirAll(skillsDir, 0o755); err != nil {
		return fmt.Errorf("create skills dir: %w", err)
	}

	for _, skill := range skills {
		dir := filepath.Join(skillsDir, sanitizeSkillName(skill.Name))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}

		// Write main SKILL.md
		if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(skill.Content), 0o644); err != nil {
			return err
		}

		// Write supporting files
		for _, f := range skill.Files {
			fpath := filepath.Join(dir, f.Path)
			if err := os.MkdirAll(filepath.Dir(fpath), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(fpath, []byte(f.Content), 0o644); err != nil {
				return err
			}
		}
	}

	return nil
}

// renderIssueContext builds the markdown content for issue_context.md.
// Sections with empty content are omitted.
func renderIssueContext(ctx TaskContextForEnv) string {
	var b strings.Builder

	if ctx.IssueTitle != "" {
		fmt.Fprintf(&b, "# Issue: %s\n\n", ctx.IssueTitle)
	}

	if ctx.IssueDescription != "" {
		b.WriteString("## Description\n\n")
		b.WriteString(ctx.IssueDescription)
		b.WriteString("\n\n")
	}

	if len(ctx.AcceptanceCriteria) > 0 {
		b.WriteString("## Acceptance Criteria\n\n")
		for _, item := range ctx.AcceptanceCriteria {
			fmt.Fprintf(&b, "- %s\n", item)
		}
		b.WriteString("\n")
	}

	if len(ctx.ContextRefs) > 0 {
		b.WriteString("## Context References\n\n")
		for _, ref := range ctx.ContextRefs {
			fmt.Fprintf(&b, "- %s\n", ref)
		}
		b.WriteString("\n")
	}

	if ctx.WorkspaceContext != "" {
		b.WriteString("## Workspace Context\n\n")
		b.WriteString(ctx.WorkspaceContext)
		b.WriteString("\n\n")
	}

	if len(ctx.AgentSkills) > 0 {
		b.WriteString("## Agent Skills\n\n")
		b.WriteString("Detailed skill instructions are in `.agent_context/skills/`.\n")
		b.WriteString("Each subdirectory contains a `SKILL.md` with instructions and any supporting files.\n\n")
		for _, skill := range ctx.AgentSkills {
			fmt.Fprintf(&b, "- **%s**\n", skill.Name)
		}
		b.WriteString("\n")
	}

	return b.String()
}
