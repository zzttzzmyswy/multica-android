package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type WorkspaceResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	Description *string `json:"description"`
	Settings    any    `json:"settings"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

func workspaceToResponse(w db.Workspace) WorkspaceResponse {
	var settings any
	if w.Settings != nil {
		json.Unmarshal(w.Settings, &settings)
	}
	if settings == nil {
		settings = map[string]any{}
	}
	return WorkspaceResponse{
		ID:          uuidToString(w.ID),
		Name:        w.Name,
		Slug:        w.Slug,
		Description: textToPtr(w.Description),
		Settings:    settings,
		CreatedAt:   timestampToString(w.CreatedAt),
		UpdatedAt:   timestampToString(w.UpdatedAt),
	}
}

type MemberResponse struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	UserID      string `json:"user_id"`
	Role        string `json:"role"`
	CreatedAt   string `json:"created_at"`
}

func memberToResponse(m db.Member) MemberResponse {
	return MemberResponse{
		ID:          uuidToString(m.ID),
		WorkspaceID: uuidToString(m.WorkspaceID),
		UserID:      uuidToString(m.UserID),
		Role:        m.Role,
		CreatedAt:   timestampToString(m.CreatedAt),
	}
}

func (h *Handler) ListWorkspaces(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}

	workspaces, err := h.Queries.ListWorkspaces(r.Context(), parseUUID(userID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list workspaces")
		return
	}

	resp := make([]WorkspaceResponse, len(workspaces))
	for i, ws := range workspaces {
		resp[i] = workspaceToResponse(ws)
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) GetWorkspace(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ws, err := h.Queries.GetWorkspace(r.Context(), parseUUID(id))
	if err != nil {
		writeError(w, http.StatusNotFound, "workspace not found")
		return
	}
	writeJSON(w, http.StatusOK, workspaceToResponse(ws))
}

type CreateWorkspaceRequest struct {
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	Description *string `json:"description"`
}

func (h *Handler) CreateWorkspace(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "user not authenticated")
		return
	}

	var req CreateWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" || req.Slug == "" {
		writeError(w, http.StatusBadRequest, "name and slug are required")
		return
	}

	ws, err := h.Queries.CreateWorkspace(r.Context(), db.CreateWorkspaceParams{
		Name:        req.Name,
		Slug:        req.Slug,
		Description: ptrToText(req.Description),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create workspace: "+err.Error())
		return
	}

	// Add creator as owner
	_, err = h.Queries.CreateMember(r.Context(), db.CreateMemberParams{
		WorkspaceID: ws.ID,
		UserID:      parseUUID(userID),
		Role:        "owner",
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add owner: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, workspaceToResponse(ws))
}

type UpdateWorkspaceRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Settings    any     `json:"settings"`
}

func (h *Handler) UpdateWorkspace(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req UpdateWorkspaceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateWorkspaceParams{
		ID: parseUUID(id),
	}
	if req.Name != nil {
		params.Name = pgtype.Text{String: *req.Name, Valid: true}
	}
	if req.Description != nil {
		params.Description = pgtype.Text{String: *req.Description, Valid: true}
	}
	if req.Settings != nil {
		s, _ := json.Marshal(req.Settings)
		params.Settings = s
	}

	ws, err := h.Queries.UpdateWorkspace(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update workspace: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, workspaceToResponse(ws))
}

func (h *Handler) ListMembers(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	members, err := h.Queries.ListMembers(r.Context(), parseUUID(workspaceID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}

	resp := make([]MemberResponse, len(members))
	for i, m := range members {
		resp[i] = memberToResponse(m)
	}

	writeJSON(w, http.StatusOK, resp)
}

type MemberWithUserResponse struct {
	ID          string  `json:"id"`
	WorkspaceID string  `json:"workspace_id"`
	UserID      string  `json:"user_id"`
	Role        string  `json:"role"`
	CreatedAt   string  `json:"created_at"`
	Name        string  `json:"name"`
	Email       string  `json:"email"`
	AvatarURL   *string `json:"avatar_url"`
}

func (h *Handler) ListMembersWithUser(w http.ResponseWriter, r *http.Request) {
	workspaceID := chi.URLParam(r, "id")
	members, err := h.Queries.ListMembersWithUser(r.Context(), parseUUID(workspaceID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list members")
		return
	}

	resp := make([]MemberWithUserResponse, len(members))
	for i, m := range members {
		resp[i] = MemberWithUserResponse{
			ID:          uuidToString(m.ID),
			WorkspaceID: uuidToString(m.WorkspaceID),
			UserID:      uuidToString(m.UserID),
			Role:        m.Role,
			CreatedAt:   timestampToString(m.CreatedAt),
			Name:        m.UserName,
			Email:       m.UserEmail,
			AvatarURL:   textToPtr(m.UserAvatarUrl),
		}
	}

	writeJSON(w, http.StatusOK, resp)
}
