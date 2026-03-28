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

// notifySubscribers queries the subscriber table for an issue, excludes the
// actor and any extra IDs, and creates inbox items for each remaining member
// subscriber. Publishes an inbox:new event for each notification.
func notifySubscribers(
	ctx context.Context,
	queries *db.Queries,
	bus *events.Bus,
	issueID string,
	workspaceID string,
	e events.Event,
	exclude map[string]bool,
	notifType string,
	severity string,
	title string,
	body string,
) {
	subs, err := queries.ListIssueSubscribers(ctx, parseUUID(issueID))
	if err != nil {
		slog.Error("failed to list subscribers for notification",
			"issue_id", issueID, "error", err)
		return
	}

	for _, sub := range subs {
		// Only notify member-type subscribers (not agents)
		if sub.UserType != "member" {
			continue
		}

		subID := util.UUIDToString(sub.UserID)

		// Skip the actor
		if subID == e.ActorID {
			continue
		}

		// Skip any extra excluded IDs
		if exclude[subID] {
			continue
		}

		item, err := queries.CreateInboxItem(ctx, db.CreateInboxItemParams{
			WorkspaceID:   parseUUID(workspaceID),
			RecipientType: "member",
			RecipientID:   sub.UserID,
			Type:          notifType,
			Severity:      severity,
			IssueID:       parseUUID(issueID),
			Title:         title,
			Body:          util.StrToText(body),
			ActorType:     util.StrToText(e.ActorType),
			ActorID:       parseUUID(e.ActorID),
		})
		if err != nil {
			slog.Error("subscriber notification creation failed",
				"subscriber_id", subID, "type", notifType, "error", err)
			continue
		}

		resp := inboxItemToResponse(item)
		bus.Publish(events.Event{
			Type:        protocol.EventInboxNew,
			WorkspaceID: workspaceID,
			ActorType:   e.ActorType,
			ActorID:     e.ActorID,
			Payload:     map[string]any{"item": resp},
		})
	}
}

// notifyDirect creates an inbox item for a specific recipient. Skips if the
// recipient is the actor. Publishes an inbox:new event on success.
func notifyDirect(
	ctx context.Context,
	queries *db.Queries,
	bus *events.Bus,
	recipientType string,
	recipientID string,
	workspaceID string,
	e events.Event,
	issueID string,
	notifType string,
	severity string,
	title string,
	body string,
) {
	// Skip if recipient is the actor
	if recipientID == e.ActorID {
		return
	}

	item, err := queries.CreateInboxItem(ctx, db.CreateInboxItemParams{
		WorkspaceID:   parseUUID(workspaceID),
		RecipientType: recipientType,
		RecipientID:   parseUUID(recipientID),
		Type:          notifType,
		Severity:      severity,
		IssueID:       parseUUID(issueID),
		Title:         title,
		Body:          util.StrToText(body),
		ActorType:     util.StrToText(e.ActorType),
		ActorID:       parseUUID(e.ActorID),
	})
	if err != nil {
		slog.Error("direct notification creation failed",
			"recipient_id", recipientID, "type", notifType, "error", err)
		return
	}

	resp := inboxItemToResponse(item)
	bus.Publish(events.Event{
		Type:        protocol.EventInboxNew,
		WorkspaceID: workspaceID,
		ActorType:   e.ActorType,
		ActorID:     e.ActorID,
		Payload:     map[string]any{"item": resp},
	})
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

// registerNotificationListeners wires up event bus listeners that create inbox
// notifications using the subscriber table. This replaces the old hardcoded
// notification logic from inbox_listeners.go.
func registerNotificationListeners(bus *events.Bus, queries *db.Queries) {
	ctx := context.Background()

	// issue:created — Direct notification to assignee if assignee != actor
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

		// Direct notification to assignee
		if issue.AssigneeType != nil && issue.AssigneeID != nil {
			skip[*issue.AssigneeID] = true
			notifyDirect(ctx, queries, bus,
				*issue.AssigneeType, *issue.AssigneeID,
				issue.WorkspaceID, e, issue.ID,
				"issue_assigned", "action_required",
				"New issue assigned: "+issue.Title,
				"",
			)
		}

		// Notify @mentions in description
		if issue.Description != nil && *issue.Description != "" {
			mentions := parseMentions(*issue.Description)
			notifyMentionedMembers(bus, queries, e, mentions, issue.ID, issue.Title, issue.Status,
				"Mentioned in: "+issue.Title, skip)
		}
	})

	// issue:updated — handle assignee changes and status changes
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

		if assigneeChanged {
			// Direct: notify new assignee about assignment
			if issue.AssigneeType != nil && issue.AssigneeID != nil {
				notifyDirect(ctx, queries, bus,
					*issue.AssigneeType, *issue.AssigneeID,
					e.WorkspaceID, e, issue.ID,
					"issue_assigned", "action_required",
					"Assigned to you: "+issue.Title,
					"",
				)
			}

			// Direct: notify old assignee about unassignment
			if prevAssigneeType != nil && prevAssigneeID != nil && *prevAssigneeType == "member" {
				notifyDirect(ctx, queries, bus,
					"member", *prevAssigneeID,
					e.WorkspaceID, e, issue.ID,
					"unassigned", "info",
					"Unassigned from: "+issue.Title,
					"",
				)
			}

			// Subscriber: notify remaining subscribers about assignee change,
			// excluding actor, old assignee, and new assignee
			exclude := map[string]bool{}
			if prevAssigneeID != nil {
				exclude[*prevAssigneeID] = true
			}
			if issue.AssigneeID != nil {
				exclude[*issue.AssigneeID] = true
			}
			notifySubscribers(ctx, queries, bus, issue.ID, e.WorkspaceID, e,
				exclude, "assignee_changed", "info",
				"Assignee changed: "+issue.Title, "")
		}

		if statusChanged {
			// Subscriber: notify all subscribers except actor
			notifySubscribers(ctx, queries, bus, issue.ID, e.WorkspaceID, e,
				nil, "status_changed", "info",
				issue.Title+" moved to "+issue.Status, "")
		}

		// Notify NEW @mentions in description
		if descriptionChanged && issue.Description != nil {
			newMentions := parseMentions(*issue.Description)
			if len(newMentions) > 0 {
				prevMentioned := map[string]bool{}
				if prevDescription != nil {
					for _, m := range parseMentions(*prevDescription) {
						prevMentioned[m.Type+":"+m.ID] = true
					}
				}
				var added []mention
				for _, m := range newMentions {
					if !prevMentioned[m.Type+":"+m.ID] {
						added = append(added, m)
					}
				}
				skip := map[string]bool{e.ActorID: true}
				notifyMentionedMembers(bus, queries, e, added, issue.ID, issue.Title, issue.Status,
					"Mentioned in: "+issue.Title, skip)
			}
		}
	})

	// comment:created — notify all subscribers except the commenter
	bus.Subscribe(protocol.EventCommentCreated, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}

		// The comment payload can come as handler.CommentResponse from the
		// HTTP handler, or as map[string]any from the agent comment path in
		// task.go. Handle both.
		var issueID, commentContent string
		switch c := payload["comment"].(type) {
		case handler.CommentResponse:
			issueID = c.IssueID
			commentContent = c.Content
		case map[string]any:
			issueID, _ = c["issue_id"].(string)
			commentContent, _ = c["content"].(string)
		default:
			return
		}

		issueTitle, _ := payload["issue_title"].(string)

		notifySubscribers(ctx, queries, bus, issueID, e.WorkspaceID, e,
			nil, "new_comment", "info",
			"New comment on: "+issueTitle, commentContent)

		// Notify @mentions in comment content
		mentions := parseMentions(commentContent)
		if len(mentions) > 0 {
			issueStatus, _ := payload["issue_status"].(string)
			skip := map[string]bool{e.ActorID: true}
			notifyMentionedMembers(bus, queries, e, mentions, issueID, issueTitle, issueStatus,
				"Mentioned in comment: "+issueTitle, skip)
		}
	})

	// task:completed — notify all subscribers except the agent
	bus.Subscribe(protocol.EventTaskCompleted, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		agentID, _ := payload["agent_id"].(string)
		issueID, _ := payload["issue_id"].(string)
		if issueID == "" {
			return
		}

		// Look up issue to get the title
		issue, err := queries.GetIssue(ctx, parseUUID(issueID))
		if err != nil {
			slog.Error("task:completed notification: failed to get issue", "issue_id", issueID, "error", err)
			return
		}

		// Use the agent ID as an exclusion (since the agent did the work)
		exclude := map[string]bool{}
		if agentID != "" {
			exclude[agentID] = true
		}

		notifySubscribers(ctx, queries, bus, issueID, e.WorkspaceID,
			events.Event{
				Type:        e.Type,
				WorkspaceID: e.WorkspaceID,
				ActorType:   "agent",
				ActorID:     agentID,
			},
			exclude, "task_completed", "attention",
			"Task completed: "+issue.Title, "")
	})

	// task:failed — notify all subscribers except the agent
	bus.Subscribe(protocol.EventTaskFailed, func(e events.Event) {
		payload, ok := e.Payload.(map[string]any)
		if !ok {
			return
		}
		agentID, _ := payload["agent_id"].(string)
		issueID, _ := payload["issue_id"].(string)
		if issueID == "" {
			return
		}

		issue, err := queries.GetIssue(ctx, parseUUID(issueID))
		if err != nil {
			slog.Error("task:failed notification: failed to get issue", "issue_id", issueID, "error", err)
			return
		}

		exclude := map[string]bool{}
		if agentID != "" {
			exclude[agentID] = true
		}

		notifySubscribers(ctx, queries, bus, issueID, e.WorkspaceID,
			events.Event{
				Type:        e.Type,
				WorkspaceID: e.WorkspaceID,
				ActorType:   "agent",
				ActorID:     agentID,
			},
			exclude, "task_failed", "action_required",
			"Task failed: "+issue.Title, "")
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
