package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type CommentResponse struct {
	ID         string `json:"id"`
	IssueID    string `json:"issue_id"`
	AuthorType string `json:"author_type"`
	AuthorID   string `json:"author_id"`
	Content    string `json:"content"`
	Type       string `json:"type"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

func commentToResponse(c db.Comment) CommentResponse {
	return CommentResponse{
		ID:         uuidToString(c.ID),
		IssueID:    uuidToString(c.IssueID),
		AuthorType: c.AuthorType,
		AuthorID:   uuidToString(c.AuthorID),
		Content:    c.Content,
		Type:       c.Type,
		CreatedAt:  timestampToString(c.CreatedAt),
		UpdatedAt:  timestampToString(c.UpdatedAt),
	}
}

func (h *Handler) ListComments(w http.ResponseWriter, r *http.Request) {
	issueID := chi.URLParam(r, "id")
	comments, err := h.Queries.ListComments(r.Context(), parseUUID(issueID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list comments")
		return
	}

	resp := make([]CommentResponse, len(comments))
	for i, c := range comments {
		resp[i] = commentToResponse(c)
	}

	writeJSON(w, http.StatusOK, resp)
}

type CreateCommentRequest struct {
	Content string `json:"content"`
	Type    string `json:"type"`
}

func (h *Handler) CreateComment(w http.ResponseWriter, r *http.Request) {
	issueID := chi.URLParam(r, "id")
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}

	var req CreateCommentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	if req.Type == "" {
		req.Type = "comment"
	}

	comment, err := h.Queries.CreateComment(r.Context(), db.CreateCommentParams{
		IssueID:    parseUUID(issueID),
		AuthorType: "member",
		AuthorID:   parseUUID(userID),
		Content:    req.Content,
		Type:       req.Type,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create comment: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, commentToResponse(comment))
}
