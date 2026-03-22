package handler

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type InboxItemResponse struct {
	ID            string  `json:"id"`
	WorkspaceID   string  `json:"workspace_id"`
	RecipientType string  `json:"recipient_type"`
	RecipientID   string  `json:"recipient_id"`
	Type          string  `json:"type"`
	Severity      string  `json:"severity"`
	IssueID       *string `json:"issue_id"`
	Title         string  `json:"title"`
	Body          *string `json:"body"`
	Read          bool    `json:"read"`
	Archived      bool    `json:"archived"`
	CreatedAt     string  `json:"created_at"`
}

func inboxToResponse(i db.InboxItem) InboxItemResponse {
	return InboxItemResponse{
		ID:            uuidToString(i.ID),
		WorkspaceID:   uuidToString(i.WorkspaceID),
		RecipientType: i.RecipientType,
		RecipientID:   uuidToString(i.RecipientID),
		Type:          i.Type,
		Severity:      i.Severity,
		IssueID:       uuidToPtr(i.IssueID),
		Title:         i.Title,
		Body:          textToPtr(i.Body),
		Read:          i.Read,
		Archived:      i.Archived,
		CreatedAt:     timestampToString(i.CreatedAt),
	}
}

func (h *Handler) ListInbox(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}

	limit := 50
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil {
			offset = v
		}
	}

	items, err := h.Queries.ListInboxItems(r.Context(), db.ListInboxItemsParams{
		RecipientType: "member",
		RecipientID:   parseUUID(userID),
		Limit:         int32(limit),
		Offset:        int32(offset),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list inbox")
		return
	}

	resp := make([]InboxItemResponse, len(items))
	for i, item := range items {
		resp[i] = inboxToResponse(item)
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) MarkInboxRead(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	item, err := h.Queries.MarkInboxRead(r.Context(), parseUUID(id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mark read")
		return
	}
	writeJSON(w, http.StatusOK, inboxToResponse(item))
}

func (h *Handler) ArchiveInboxItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	item, err := h.Queries.ArchiveInboxItem(r.Context(), parseUUID(id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive")
		return
	}
	writeJSON(w, http.StatusOK, inboxToResponse(item))
}
