package handler

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/multica-ai/multica/server/internal/logger"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
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
	userID, ok := requireUserID(w, r)
	if !ok {
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
	if _, ok := h.loadInboxItemForUser(w, r, id); !ok {
		return
	}
	item, err := h.Queries.MarkInboxRead(r.Context(), parseUUID(id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mark read")
		return
	}

	userID := requestUserID(r)
	workspaceID := uuidToString(item.WorkspaceID)
	h.publish(protocol.EventInboxRead, workspaceID, "member", userID, map[string]any{
		"item_id":      uuidToString(item.ID),
		"recipient_id": uuidToString(item.RecipientID),
	})

	writeJSON(w, http.StatusOK, inboxToResponse(item))
}

func (h *Handler) ArchiveInboxItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, ok := h.loadInboxItemForUser(w, r, id); !ok {
		return
	}
	item, err := h.Queries.ArchiveInboxItem(r.Context(), parseUUID(id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive")
		return
	}

	userID := requestUserID(r)
	workspaceID := uuidToString(item.WorkspaceID)
	h.publish(protocol.EventInboxArchived, workspaceID, "member", userID, map[string]any{
		"item_id":      uuidToString(item.ID),
		"recipient_id": uuidToString(item.RecipientID),
	})

	writeJSON(w, http.StatusOK, inboxToResponse(item))
}

func (h *Handler) CountUnreadInbox(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	count, err := h.Queries.CountUnreadInbox(r.Context(), db.CountUnreadInboxParams{
		RecipientType: "member",
		RecipientID:   parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to count unread inbox")
		return
	}

	writeJSON(w, http.StatusOK, map[string]int64{"count": count})
}

func (h *Handler) MarkAllInboxRead(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	count, err := h.Queries.MarkAllInboxRead(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to mark all inbox read")
		return
	}

	slog.Info("inbox: mark all read", append(logger.RequestAttrs(r), "user_id", userID, "count", count)...)
	workspaceID := r.Header.Get("X-Workspace-ID")
	h.publish(protocol.EventInboxBatchRead, workspaceID, "member", userID, map[string]any{
		"recipient_id": userID,
		"count":        count,
	})

	writeJSON(w, http.StatusOK, map[string]any{"count": count})
}

func (h *Handler) ArchiveAllInbox(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	count, err := h.Queries.ArchiveAllInbox(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive all inbox")
		return
	}

	slog.Info("inbox: archive all", append(logger.RequestAttrs(r), "user_id", userID, "count", count)...)
	workspaceID := r.Header.Get("X-Workspace-ID")
	h.publish(protocol.EventInboxBatchArchived, workspaceID, "member", userID, map[string]any{
		"recipient_id": userID,
		"count":        count,
	})

	writeJSON(w, http.StatusOK, map[string]any{"count": count})
}

func (h *Handler) ArchiveAllReadInbox(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	count, err := h.Queries.ArchiveAllReadInbox(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive all read inbox")
		return
	}

	slog.Info("inbox: archive all read", append(logger.RequestAttrs(r), "user_id", userID, "count", count)...)
	workspaceID := r.Header.Get("X-Workspace-ID")
	h.publish(protocol.EventInboxBatchArchived, workspaceID, "member", userID, map[string]any{
		"recipient_id": userID,
		"count":        count,
	})

	writeJSON(w, http.StatusOK, map[string]any{"count": count})
}

func (h *Handler) ArchiveCompletedInbox(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}

	count, err := h.Queries.ArchiveCompletedInbox(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to archive completed inbox")
		return
	}

	slog.Info("inbox: archive completed", append(logger.RequestAttrs(r), "user_id", userID, "count", count)...)
	workspaceID := r.Header.Get("X-Workspace-ID")
	h.publish(protocol.EventInboxBatchArchived, workspaceID, "member", userID, map[string]any{
		"recipient_id": userID,
		"count":        count,
	})

	writeJSON(w, http.StatusOK, map[string]any{"count": count})
}
