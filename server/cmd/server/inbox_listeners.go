package main

import (
	"context"
	"log/slog"
	"regexp"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/internal/handler"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// mention represents a parsed @mention from markdown content.
type mention struct {
	Type string // "member" or "agent"
	ID   string // user_id or agent_id
}

// mentionRe matches [@Label](mention://type/id) in markdown.
var mentionRe = regexp.MustCompile(`\[@[^\]]*\]\(mention://(member|agent)/([0-9a-fA-F-]+)\)`)

// parseMentions extracts mentions from markdown content.
func parseMentions(content string) []mention {
	matches := mentionRe.FindAllStringSubmatch(content, -1)
	seen := make(map[string]bool)
	var result []mention
	for _, m := range matches {
		key := m[1] + ":" + m[2]
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, mention{Type: m[1], ID: m[2]})
	}
	return result
}

// notifyMentionedMembers creates inbox items for each @mentioned member,
// excluding the actor and any IDs in the skip set.
func notifyMentionedMembers(
	bus *events.Bus,
	queries *db.Queries,
	e events.Event,
	mentions []mention,
	issueID string,
	issueTitle string,
	issueStatus string,
	title string,
	skip map[string]bool,
) {
	for _, m := range mentions {
		if m.Type != "member" {
			continue
		}
		if m.ID == e.ActorID || skip[m.ID] {
			continue
		}
		item, err := queries.CreateInboxItem(context.Background(), db.CreateInboxItemParams{
			WorkspaceID:   parseUUID(e.WorkspaceID),
			RecipientType: "member",
			RecipientID:   parseUUID(m.ID),
			Type:          "mentioned",
			Severity:      "info",
			IssueID:       parseUUID(issueID),
			Title:         title,
			ActorType:     util.StrToText(e.ActorType),
			ActorID:       parseUUID(e.ActorID),
		})
		if err != nil {
			slog.Error("mention inbox creation failed", "mentioned_id", m.ID, "error", err)
			continue
		}
		resp := inboxItemToResponse(item)
		resp["issue_status"] = issueStatus
		bus.Publish(events.Event{
			Type:        protocol.EventInboxNew,
			WorkspaceID: e.WorkspaceID,
			ActorType:   e.ActorType,
			ActorID:     e.ActorID,
			Payload:     map[string]any{"item": resp},
		})
	}
}

// registerInboxListeners wires up event bus listeners that create inbox
// notifications. This replaces the inline CreateInboxItem calls that were
// previously scattered across issue and comment handlers.
func registerInboxListeners(bus *events.Bus, queries *db.Queries) {
	// issue:created — notify assignee about new assignment + @mentions in description
	bus.Subscribe(protocol.EventIssueCreated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		issue, ok := payload["issue"].(handler.IssueResponse)
		if !ok {
			return
		}

		// Track who already got notified to avoid duplicates
		skip := map[string]bool{e.ActorID: true}

		// Notify assignee
		if issue.AssigneeType != nil && issue.AssigneeID != nil {
			skip[*issue.AssigneeID] = true
			item, err := queries.CreateInboxItem(context.Background(), db.CreateInboxItemParams{
				WorkspaceID:   parseUUID(issue.WorkspaceID),
				RecipientType: *issue.AssigneeType,
				RecipientID:   parseUUID(*issue.AssigneeID),
				Type:          "issue_assigned",
				Severity:      "action_required",
				IssueID:       parseUUID(issue.ID),
				Title:         "New issue assigned: " + issue.Title,
				Body:          util.PtrToText(issue.Description),
				ActorType:     util.StrToText(e.ActorType),
				ActorID:       parseUUID(e.ActorID),
			})
			if err != nil {
				slog.Error("inbox item creation failed", "event", "issue:created", "error", err)
			} else {
				resp := inboxItemToResponse(item)
				resp["issue_status"] = issue.Status
				bus.Publish(events.Event{
					Type:        protocol.EventInboxNew,
					WorkspaceID: e.WorkspaceID,
					ActorType:   e.ActorType,
					ActorID:     e.ActorID,
					Payload:     map[string]any{"item": resp},
				})
			}
		}

		// Notify @mentions in description
		if issue.Description != nil && *issue.Description != "" {
			mentions := parseMentions(*issue.Description)
			notifyMentionedMembers(bus, queries, e, mentions, issue.ID, issue.Title, issue.Status,
				"Mentioned in: "+issue.Title, skip)
		}
	})

	// issue:updated — notify on assignee change and status change
	bus.Subscribe(protocol.EventIssueUpdated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		issue, ok := payload["issue"].(handler.IssueResponse)
		if !ok {
			return
		}
		assigneeChanged, _ := payload["assignee_changed"].(bool)
		statusChanged, _ := payload["status_changed"].(bool)
		descriptionChanged, _ := payload["description_changed"].(bool)
		prevAssigneeType, _ := payload["prev_assignee_type"].(*string)
		prevAssigneeID, _ := payload["prev_assignee_id"].(*string)
		prevDescription, _ := payload["prev_description"].(*string)
		creatorType, _ := payload["creator_type"].(string)
		creatorID, _ := payload["creator_id"].(string)

		actorID := e.ActorID // the user who made the change

		if assigneeChanged {
			// Notify old assignee about unassignment
			if prevAssigneeType != nil && prevAssigneeID != nil &&
				*prevAssigneeType == "member" && *prevAssigneeID != actorID {
				oldItem, err := queries.CreateInboxItem(context.Background(), db.CreateInboxItemParams{
					WorkspaceID:   parseUUID(e.WorkspaceID),
					RecipientType: "member",
					RecipientID:   parseUUID(*prevAssigneeID),
					Type:          "status_change",
					Severity:      "info",
					IssueID:       parseUUID(issue.ID),
					Title:         "Unassigned from: " + issue.Title,
					ActorType:     util.StrToText(e.ActorType),
					ActorID:       parseUUID(e.ActorID),
				})
				if err == nil {
					oldResp := inboxItemToResponse(oldItem)
					oldResp["issue_status"] = issue.Status
					bus.Publish(events.Event{
						Type:        protocol.EventInboxNew,
						WorkspaceID: e.WorkspaceID,
						ActorType:   e.ActorType,
						ActorID:     actorID,
						Payload:     map[string]any{"item": oldResp},
					})
				}
			}

			// Notify new assignee about assignment
			if issue.AssigneeType != nil && issue.AssigneeID != nil {
				newItem, err := queries.CreateInboxItem(context.Background(), db.CreateInboxItemParams{
					WorkspaceID:   parseUUID(e.WorkspaceID),
					RecipientType: *issue.AssigneeType,
					RecipientID:   parseUUID(*issue.AssigneeID),
					Type:          "issue_assigned",
					Severity:      "action_required",
					IssueID:       parseUUID(issue.ID),
					Title:         "Assigned to you: " + issue.Title,
					ActorType:     util.StrToText(e.ActorType),
					ActorID:       parseUUID(e.ActorID),
				})
				if err == nil {
					newResp := inboxItemToResponse(newItem)
					newResp["issue_status"] = issue.Status
					bus.Publish(events.Event{
						Type:        protocol.EventInboxNew,
						WorkspaceID: e.WorkspaceID,
						ActorType:   e.ActorType,
						ActorID:     actorID,
						Payload:     map[string]any{"item": newResp},
					})
				}
			}
		}

		if statusChanged {
			// Notify assignee about status change
			if issue.AssigneeType != nil && issue.AssigneeID != nil {
				aItem, err := queries.CreateInboxItem(context.Background(), db.CreateInboxItemParams{
					WorkspaceID:   parseUUID(e.WorkspaceID),
					RecipientType: *issue.AssigneeType,
					RecipientID:   parseUUID(*issue.AssigneeID),
					Type:          "status_change",
					Severity:      "info",
					IssueID:       parseUUID(issue.ID),
					Title:         issue.Title + " moved to " + issue.Status,
					ActorType:     util.StrToText(e.ActorType),
					ActorID:       parseUUID(e.ActorID),
				})
				if err == nil {
					aResp := inboxItemToResponse(aItem)
					aResp["issue_status"] = issue.Status
					bus.Publish(events.Event{
						Type:        protocol.EventInboxNew,
						WorkspaceID: e.WorkspaceID,
						ActorType:   e.ActorType,
						ActorID:     actorID,
						Payload:     map[string]any{"item": aResp},
					})
				}
			}

			// Notify creator about status change (if creator is member and != the person making change)
			if creatorType == "member" && creatorID != actorID {
				// Don't double-notify if creator is also the assignee
				isAlsoAssignee := prevAssigneeID != nil && *prevAssigneeID == creatorID
				if !isAlsoAssignee {
					cItem, err := queries.CreateInboxItem(context.Background(), db.CreateInboxItemParams{
						WorkspaceID:   parseUUID(e.WorkspaceID),
						RecipientType: "member",
						RecipientID:   parseUUID(creatorID),
						Type:          "status_change",
						Severity:      "info",
						IssueID:       parseUUID(issue.ID),
						Title:         "Status changed: " + issue.Title,
						ActorType:     util.StrToText(e.ActorType),
						ActorID:       parseUUID(e.ActorID),
					})
					if err == nil {
						cResp := inboxItemToResponse(cItem)
						cResp["issue_status"] = issue.Status
						bus.Publish(events.Event{
							Type:        protocol.EventInboxNew,
							WorkspaceID: e.WorkspaceID,
							ActorType:   e.ActorType,
							ActorID:     actorID,
							Payload:     map[string]any{"item": cResp},
						})
					}
				}
			}
		}

		// Notify NEW @mentions in description (only mentions that weren't in previous description)
		if descriptionChanged && issue.Description != nil {
			newMentions := parseMentions(*issue.Description)
			if len(newMentions) > 0 {
				// Build set of previously mentioned IDs
				prevMentioned := map[string]bool{}
				if prevDescription != nil {
					for _, m := range parseMentions(*prevDescription) {
						prevMentioned[m.Type+":"+m.ID] = true
					}
				}
				// Filter to only new mentions
				var added []mention
				for _, m := range newMentions {
					if !prevMentioned[m.Type+":"+m.ID] {
						added = append(added, m)
					}
				}
				skip := map[string]bool{actorID: true}
				notifyMentionedMembers(bus, queries, e, added, issue.ID, issue.Title, issue.Status,
					"Mentioned in: "+issue.Title, skip)
			}
		}
	})

	// comment:created — notify issue assignee + @mentions in comment
	bus.Subscribe(protocol.EventCommentCreated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		comment, ok := payload["comment"].(handler.CommentResponse)
		if !ok {
			return
		}
		issueTitle, _ := payload["issue_title"].(string)
		issueAssigneeType, _ := payload["issue_assignee_type"].(*string)
		issueAssigneeID, _ := payload["issue_assignee_id"].(*string)
		issueStatus, _ := payload["issue_status"].(string)

		// Track who already got notified
		skip := map[string]bool{e.ActorID: true}

		// Notify assignee (if member and not the commenter)
		if issueAssigneeType != nil && issueAssigneeID != nil &&
			*issueAssigneeType == "member" && *issueAssigneeID != e.ActorID {
			skip[*issueAssigneeID] = true
			item, err := queries.CreateInboxItem(context.Background(), db.CreateInboxItemParams{
				WorkspaceID:   parseUUID(e.WorkspaceID),
				RecipientType: "member",
				RecipientID:   parseUUID(*issueAssigneeID),
				Type:          "mentioned",
				Severity:      "info",
				IssueID:       parseUUID(comment.IssueID),
				Title:         "New comment on: " + issueTitle,
				Body:          util.StrToText(comment.Content),
				ActorType:     util.StrToText(e.ActorType),
				ActorID:       parseUUID(e.ActorID),
			})
			if err != nil {
				slog.Error("inbox item creation failed", "event", "comment:created", "error", err)
			} else {
				commentResp := inboxItemToResponse(item)
				commentResp["issue_status"] = issueStatus
				bus.Publish(events.Event{
					Type:        protocol.EventInboxNew,
					WorkspaceID: e.WorkspaceID,
					ActorType:   e.ActorType,
					ActorID:     e.ActorID,
					Payload:     map[string]any{"item": commentResp},
				})
			}
		}

		// Notify @mentions in comment content
		mentions := parseMentions(comment.Content)
		notifyMentionedMembers(bus, queries, e, mentions, comment.IssueID, issueTitle, issueStatus,
			"Mentioned in comment: "+issueTitle, skip)
	})
}

// inboxItemToResponse converts a db.InboxItem into a map suitable for
// JSON-serializable event payloads (mirrors handler.inboxToResponse fields).
func inboxItemToResponse(item db.InboxItem) map[string]any {
	return map[string]any{
		"id":             util.UUIDToString(item.ID),
		"workspace_id":   util.UUIDToString(item.WorkspaceID),
		"recipient_type": item.RecipientType,
		"recipient_id":   util.UUIDToString(item.RecipientID),
		"type":           item.Type,
		"severity":       item.Severity,
		"issue_id":       util.UUIDToPtr(item.IssueID),
		"title":          item.Title,
		"body":           util.TextToPtr(item.Body),
		"read":           item.Read,
		"archived":       item.Archived,
		"created_at":     util.TimestampToString(item.CreatedAt),
		"actor_type":     util.TextToPtr(item.ActorType),
		"actor_id":       util.UUIDToPtr(item.ActorID),
	}
}
