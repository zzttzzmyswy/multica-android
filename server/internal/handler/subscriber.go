package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

// SubscriberResponse is the JSON shape returned for each issue subscriber.
type SubscriberResponse struct {
	IssueID   string `json:"issue_id"`
	UserType  string `json:"user_type"`
	UserID    string `json:"user_id"`
	Reason    string `json:"reason"`
	CreatedAt string `json:"created_at"`
}

func subscriberToResponse(s db.IssueSubscriber) SubscriberResponse {
	return SubscriberResponse{
		IssueID:   uuidToString(s.IssueID),
		UserType:  s.UserType,
		UserID:    uuidToString(s.UserID),
		Reason:    s.Reason,
		CreatedAt: timestampToString(s.CreatedAt),
	}
}

// ListIssueSubscribers returns all subscribers for an issue.
func (h *Handler) ListIssueSubscribers(w http.ResponseWriter, r *http.Request) {
	issueID := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, issueID)
	if !ok {
		return
	}

	subscribers, err := h.Queries.ListIssueSubscribers(r.Context(), issue.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list subscribers")
		return
	}

	resp := make([]SubscriberResponse, len(subscribers))
	for i, s := range subscribers {
		resp[i] = subscriberToResponse(s)
	}

	writeJSON(w, http.StatusOK, resp)
}

// SubscribeToIssue subscribes the current user to an issue with reason "manual".
func (h *Handler) SubscribeToIssue(w http.ResponseWriter, r *http.Request) {
	issueID := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, issueID)
	if !ok {
		return
	}

	userID := requestUserID(r)

	err := h.Queries.AddIssueSubscriber(r.Context(), db.AddIssueSubscriberParams{
		IssueID:  issue.ID,
		UserType: "member",
		UserID:   parseUUID(userID),
		Reason:   "manual",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to subscribe")
		return
	}

	workspaceID := uuidToString(issue.WorkspaceID)
	h.publish(protocol.EventSubscriberAdded, workspaceID, "member", userID, map[string]any{
		"issue_id": issueID,
		"user_id":  userID,
		"reason":   "manual",
	})

	writeJSON(w, http.StatusOK, map[string]bool{"subscribed": true})
}

// UnsubscribeFromIssue removes the current user's subscription from an issue.
func (h *Handler) UnsubscribeFromIssue(w http.ResponseWriter, r *http.Request) {
	issueID := chi.URLParam(r, "id")
	issue, ok := h.loadIssueForUser(w, r, issueID)
	if !ok {
		return
	}

	userID := requestUserID(r)

	err := h.Queries.RemoveIssueSubscriber(r.Context(), db.RemoveIssueSubscriberParams{
		IssueID:  issue.ID,
		UserType: "member",
		UserID:   parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to unsubscribe")
		return
	}

	workspaceID := uuidToString(issue.WorkspaceID)
	h.publish(protocol.EventSubscriberRemoved, workspaceID, "member", userID, map[string]any{
		"issue_id": issueID,
		"user_id":  userID,
	})

	writeJSON(w, http.StatusOK, map[string]bool{"subscribed": false})
}
