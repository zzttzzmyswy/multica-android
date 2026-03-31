package util

import "regexp"

// Mention represents a parsed @mention from markdown content.
type Mention struct {
	Type string // "member" or "agent"
	ID   string // user_id or agent_id
}

// MentionRe matches [@Label](mention://type/id) in markdown.
var MentionRe = regexp.MustCompile(`\[@[^\]]*\]\(mention://(member|agent)/([0-9a-fA-F-]+)\)`)

// ParseMentions extracts deduplicated mentions from markdown content.
func ParseMentions(content string) []Mention {
	matches := MentionRe.FindAllStringSubmatch(content, -1)
	seen := make(map[string]bool)
	var result []Mention
	for _, m := range matches {
		key := m[1] + ":" + m[2]
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, Mention{Type: m[1], ID: m[2]})
	}
	return result
}
