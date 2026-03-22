package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

type AgentResponse struct {
	ID                 string `json:"id"`
	WorkspaceID        string `json:"workspace_id"`
	Name               string `json:"name"`
	AvatarURL          *string `json:"avatar_url"`
	RuntimeMode        string `json:"runtime_mode"`
	RuntimeConfig      any    `json:"runtime_config"`
	Visibility         string `json:"visibility"`
	Status             string `json:"status"`
	MaxConcurrentTasks int32  `json:"max_concurrent_tasks"`
	OwnerID            *string `json:"owner_id"`
	CreatedAt          string `json:"created_at"`
	UpdatedAt          string `json:"updated_at"`
}

func agentToResponse(a db.Agent) AgentResponse {
	var rc any
	if a.RuntimeConfig != nil {
		json.Unmarshal(a.RuntimeConfig, &rc)
	}
	if rc == nil {
		rc = map[string]any{}
	}
	return AgentResponse{
		ID:                 uuidToString(a.ID),
		WorkspaceID:        uuidToString(a.WorkspaceID),
		Name:               a.Name,
		AvatarURL:          textToPtr(a.AvatarUrl),
		RuntimeMode:        a.RuntimeMode,
		RuntimeConfig:      rc,
		Visibility:         a.Visibility,
		Status:             a.Status,
		MaxConcurrentTasks: a.MaxConcurrentTasks,
		OwnerID:            uuidToPtr(a.OwnerID),
		CreatedAt:          timestampToString(a.CreatedAt),
		UpdatedAt:          timestampToString(a.UpdatedAt),
	}
}

func (h *Handler) ListAgents(w http.ResponseWriter, r *http.Request) {
	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		workspaceID = r.Header.Get("X-Workspace-ID")
	}
	if workspaceID == "" {
		writeError(w, http.StatusBadRequest, "workspace_id is required")
		return
	}

	agents, err := h.Queries.ListAgents(r.Context(), parseUUID(workspaceID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list agents")
		return
	}

	resp := make([]AgentResponse, len(agents))
	for i, a := range agents {
		resp[i] = agentToResponse(a)
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) GetAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	agent, err := h.Queries.GetAgent(r.Context(), parseUUID(id))
	if err != nil {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	writeJSON(w, http.StatusOK, agentToResponse(agent))
}

type CreateAgentRequest struct {
	Name               string  `json:"name"`
	AvatarURL          *string `json:"avatar_url"`
	RuntimeMode        string  `json:"runtime_mode"`
	RuntimeConfig      any     `json:"runtime_config"`
	Visibility         string  `json:"visibility"`
	MaxConcurrentTasks int32   `json:"max_concurrent_tasks"`
}

func (h *Handler) CreateAgent(w http.ResponseWriter, r *http.Request) {
	var req CreateAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	workspaceID := r.URL.Query().Get("workspace_id")
	if workspaceID == "" {
		workspaceID = r.Header.Get("X-Workspace-ID")
	}
	ownerID := r.Header.Get("X-User-ID")

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.RuntimeMode == "" {
		req.RuntimeMode = "local"
	}
	if req.Visibility == "" {
		req.Visibility = "workspace"
	}
	if req.MaxConcurrentTasks == 0 {
		req.MaxConcurrentTasks = 1
	}

	rc, _ := json.Marshal(req.RuntimeConfig)
	if req.RuntimeConfig == nil {
		rc = []byte("{}")
	}

	agent, err := h.Queries.CreateAgent(r.Context(), db.CreateAgentParams{
		WorkspaceID:        parseUUID(workspaceID),
		Name:               req.Name,
		AvatarUrl:          ptrToText(req.AvatarURL),
		RuntimeMode:        req.RuntimeMode,
		RuntimeConfig:      rc,
		Visibility:         req.Visibility,
		MaxConcurrentTasks: req.MaxConcurrentTasks,
		OwnerID:            parseUUID(ownerID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create agent: "+err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, agentToResponse(agent))
}

type UpdateAgentRequest struct {
	Name               *string `json:"name"`
	AvatarURL          *string `json:"avatar_url"`
	RuntimeConfig      any     `json:"runtime_config"`
	Visibility         *string `json:"visibility"`
	Status             *string `json:"status"`
	MaxConcurrentTasks *int32  `json:"max_concurrent_tasks"`
}

func (h *Handler) UpdateAgent(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req UpdateAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	params := db.UpdateAgentParams{
		ID: parseUUID(id),
	}
	if req.Name != nil {
		params.Name = pgtype.Text{String: *req.Name, Valid: true}
	}
	if req.AvatarURL != nil {
		params.AvatarUrl = pgtype.Text{String: *req.AvatarURL, Valid: true}
	}
	if req.RuntimeConfig != nil {
		rc, _ := json.Marshal(req.RuntimeConfig)
		params.RuntimeConfig = rc
	}
	if req.Visibility != nil {
		params.Visibility = pgtype.Text{String: *req.Visibility, Valid: true}
	}
	if req.Status != nil {
		params.Status = pgtype.Text{String: *req.Status, Valid: true}
	}
	if req.MaxConcurrentTasks != nil {
		params.MaxConcurrentTasks = pgtype.Int4{Int32: *req.MaxConcurrentTasks, Valid: true}
	}

	agent, err := h.Queries.UpdateAgent(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update agent: "+err.Error())
		return
	}

	resp := agentToResponse(agent)
	h.broadcast("agent:status", map[string]any{"agent": resp})
	writeJSON(w, http.StatusOK, resp)
}
