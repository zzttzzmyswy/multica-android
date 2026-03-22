package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// IssueResponse is the JSON response for an issue.
type IssueResponse struct {
	ID                 string   `json:"id"`
	WorkspaceID        string   `json:"workspace_id"`
	Title              string   `json:"title"`
	Description        *string  `json:"description"`
	Status             string   `json:"status"`
	Priority           string   `json:"priority"`
	AssigneeType       *string  `json:"assignee_type"`
	AssigneeID         *string  `json:"assignee_id"`
	CreatorType        string   `json:"creator_type"`
	CreatorID          string   `json:"creator_id"`
	ParentIssueID      *string  `json:"parent_issue_id"`
	AcceptanceCriteria []any    `json:"acceptance_criteria"`
	ContextRefs        []any    `json:"context_refs"`
	Repository         any      `json:"repository"`
	Position           float64  `json:"position"`
	DueDate            *string  `json:"due_date"`
	CreatedAt          string   `json:"created_at"`
	UpdatedAt          string   `json:"updated_at"`
}

func issueToResponse(i db.Issue) IssueResponse {
	var ac []any
	if i.AcceptanceCriteria != nil {
		json.Unmarshal(i.AcceptanceCriteria, &ac)
	}
	if ac == nil {
		ac = []any{}
	}

	var cr []any
	if i.ContextRefs != nil {
		json.Unmarshal(i.ContextRefs, &cr)
	}
	if cr == nil {
		cr = []any{}
	}

	var repo any
	if i.Repository != nil {
		json.Unmarshal(i.Repository, &repo)
	}

	return IssueResponse{
		ID:                 uuidToString(i.ID),
		WorkspaceID:        uuidToString(i.WorkspaceID),
		Title:              i.Title,
		Description:        textToPtr(i.Description),
		Status:             i.Status,
		Priority:           i.Priority,
		AssigneeType:       textToPtr(i.AssigneeType),
		AssigneeID:         uuidToPtr(i.AssigneeID),
		CreatorType:        i.CreatorType,
		CreatorID:          uuidToString(i.CreatorID),
		ParentIssueID:      uuidToPtr(i.ParentIssueID),
		AcceptanceCriteria: ac,
		ContextRefs:        cr,
		Repository:         repo,
		Position:           i.Position,
		DueDate:            timestampToPtr(i.DueDate),
		CreatedAt:          timestampToString(i.CreatedAt),
		UpdatedAt:          timestampToString(i.UpdatedAt),
	}
}

func (h *Handler) ListIssues(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		workspaceID = r.Header.Get("X-Workspace-ID")
	}
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	limit := 100
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

	issues, err := h.Queries.ListIssues(ctx, db.ListIssuesParams{
		WorkspaceID: parseUUID(workspaceID),
		Limit:       int32(limit),
		Offset:      int32(offset),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list issues")
		return
	}

	resp := make([]IssueResponse, len(issues))
	for i, issue := range issues {
		resp[i] = issueToResponse(issue)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"issues": resp,
		"total":  len(resp),
	})
}

func (h *Handler) GetIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	issue, err := h.Queries.GetIssue(r.Context(), parseUUID(id))
	if err != nil {
		writeError(w, http.StatusNotFound, "issue not found")
		return
	}
	writeJSON(w, http.StatusOK, issueToResponse(issue))
}

type CreateIssueRequest struct {
	Title              string  `json:"title"`
	Description        *string `json:"description"`
	Status             string  `json:"status"`
	Priority           string  `json:"priority"`
	AssigneeType       *string `json:"assignee_type"`
	AssigneeID         *string `json:"assignee_id"`
	ParentIssueID      *string `json:"parent_issue_id"`
	AcceptanceCriteria []any   `json:"acceptance_criteria"`
	ContextRefs        []any   `json:"context_refs"`
	Repository         any     `json:"repository"`
}

func (h *Handler) CreateIssue(w http.ResponseWriter, r *http.Request) {
	var req CreateIssueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}

	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		workspaceID = r.Header.Get("X-Workspace-ID")
	}
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	// Get creator from context (set by auth middleware)
	creatorID := r.Header.Get("X-User-ID")
	if creatorID == "" {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}

	status := req.Status
	if status == "" {
		status = "backlog"
	}
	priority := req.Priority
	if priority == "" {
		priority = "none"
	}

	ac, _ := json.Marshal(req.AcceptanceCriteria)
	if req.AcceptanceCriteria == nil {
		ac = []byte("[]")
	}
	cr, _ := json.Marshal(req.ContextRefs)
	if req.ContextRefs == nil {
		cr = []byte("[]")
	}
	var repo []byte
	if req.Repository != nil {
		repo, _ = json.Marshal(req.Repository)
	}

	var assigneeType pgtype.Text
	var assigneeID pgtype.UUID
	if req.AssigneeType != nil {
		assigneeType = pgtype.Text{String: *req.AssigneeType, Valid: true}
	}
	if req.AssigneeID != nil {
		assigneeID = parseUUID(*req.AssigneeID)
	}

	var parentIssueID pgtype.UUID
	if req.ParentIssueID != nil {
		parentIssueID = parseUUID(*req.ParentIssueID)
	}

	issue, err := h.Queries.CreateIssue(r.Context(), db.CreateIssueParams{
		WorkspaceID:        parseUUID(workspaceID),
		Title:              req.Title,
		Description:        ptrToText(req.Description),
		Status:             status,
		Priority:           priority,
		AssigneeType:       assigneeType,
		AssigneeID:         assigneeID,
		CreatorType:        "member",
		CreatorID:          parseUUID(creatorID),
		ParentIssueID:      parentIssueID,
		AcceptanceCriteria: ac,
		ContextRefs:        cr,
		Repository:         repo,
		Position:           0,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create issue: "+err.Error())
		return
	}

	resp := issueToResponse(issue)
	h.broadcast("issue:created", map[string]any{"issue": resp})

	// Create inbox notification for assignee
	if issue.AssigneeType.Valid && issue.AssigneeID.Valid {
		inboxItem, err := h.Queries.CreateInboxItem(r.Context(), db.CreateInboxItemParams{
			WorkspaceID:   issue.WorkspaceID,
			RecipientType: issue.AssigneeType.String,
			RecipientID:   issue.AssigneeID,
			Type:          "issue_assigned",
			Severity:      "action_required",
			IssueID:       issue.ID,
			Title:         "New issue assigned: " + issue.Title,
			Body:          ptrToText(req.Description),
		})
		if err == nil {
			h.broadcast("inbox:new", map[string]any{"item": inboxToResponse(inboxItem)})
		}
	}

	writeJSON(w, http.StatusCreated, resp)
}

type UpdateIssueRequest struct {
	Title        *string  `json:"title"`
	Description  *string  `json:"description"`
	Status       *string  `json:"status"`
	Priority     *string  `json:"priority"`
	AssigneeType *string  `json:"assignee_type"`
	AssigneeID   *string  `json:"assignee_id"`
	Position     *float64 `json:"position"`
}

func (h *Handler) UpdateIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req UpdateIssueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateIssueParams{
		ID: parseUUID(id),
	}

	if req.Title != nil {
		params.Title = pgtype.Text{String: *req.Title, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.Status != nil {
		params.Status = pgtype.Text{String: *req.Status, Valid: true}
	}
	if req.Priority != nil {
		params.Priority = pgtype.Text{String: *req.Priority, Valid: true}
	}
	if req.AssigneeType != nil {
		params.AssigneeType = pgtype.Text{String: *req.AssigneeType, Valid: true}
	}
	if req.AssigneeID != nil {
		params.AssigneeID = parseUUID(*req.AssigneeID)
	}
	if req.Position != nil {
		params.Position = pgtype.Float8{Float64: *req.Position, Valid: true}
	}

	issue, err := h.Queries.UpdateIssue(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update issue: "+err.Error())
		return
	}

	resp := issueToResponse(issue)
	h.broadcast("issue:updated", map[string]any{"issue": resp})

	// If status changed, create a notification
	if req.Status != nil {
		if issue.AssigneeType.Valid && issue.AssigneeID.Valid {
			inboxItem, err := h.Queries.CreateInboxItem(r.Context(), db.CreateInboxItemParams{
				WorkspaceID:   issue.WorkspaceID,
				RecipientType: issue.AssigneeType.String,
				RecipientID:   issue.AssigneeID,
				Type:          "status_change",
				Severity:      "info",
				IssueID:       issue.ID,
				Title:         issue.Title + " moved to " + *req.Status,
			})
			if err == nil {
				h.broadcast("inbox:new", map[string]any{"item": inboxToResponse(inboxItem)})
			}
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteIssue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	err := h.Queries.DeleteIssue(r.Context(), parseUUID(id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete issue")
		return
	}

	h.broadcast("issue:deleted", map[string]any{"issue_id": id})
	w.WriteHeader(http.StatusNoContent)
}
