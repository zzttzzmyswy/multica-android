package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// ---------------------------------------------------------------------------
// Daemon Registration & Heartbeat
// ---------------------------------------------------------------------------

type DaemonRegisterRequest struct {
	DaemonID string `json:"daemon_id"`
	AgentID  string `json:"agent_id"`
	Runtimes []struct {
		Type    string `json:"type"`
		Version string `json:"version"`
		Status  string `json:"status"`
	} `json:"runtimes"`
}

func (h *Handler) DaemonRegister(w http.ResponseWriter, r *http.Request) {
	var req DaemonRegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.DaemonID == "" || req.AgentID == "" {
		writeError(w, http.StatusBadRequest, "daemon_id and agent_id are required")
		return
	}

	runtimeInfo, _ := json.Marshal(req.Runtimes)

	conn, err := h.Queries.UpsertDaemonConnection(r.Context(), db.UpsertDaemonConnectionParams{
		AgentID:     parseUUID(req.AgentID),
		DaemonID:    req.DaemonID,
		RuntimeInfo: runtimeInfo,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to register daemon: "+err.Error())
		return
	}

	// Reconcile agent status (set to idle if no running tasks)
	h.TaskService.ReconcileAgentStatus(r.Context(), parseUUID(req.AgentID))

	writeJSON(w, http.StatusOK, map[string]any{
		"connection_id": uuidToString(conn.ID),
		"status":        conn.Status,
	})
}

type DaemonHeartbeatRequest struct {
	DaemonID     string `json:"daemon_id"`
	AgentID      string `json:"agent_id"`
	CurrentTasks int    `json:"current_tasks"`
}

func (h *Handler) DaemonHeartbeat(w http.ResponseWriter, r *http.Request) {
	var req DaemonHeartbeatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	err := h.Queries.UpdateDaemonHeartbeat(r.Context(), db.UpdateDaemonHeartbeatParams{
		DaemonID: req.DaemonID,
		AgentID:  parseUUID(req.AgentID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "heartbeat failed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ---------------------------------------------------------------------------
// Task Lifecycle (called by daemon)
// ---------------------------------------------------------------------------

// ClaimTask atomically claims the next queued task for an agent.
func (h *Handler) ClaimTask(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentId")

	task, err := h.TaskService.ClaimTask(r.Context(), parseUUID(agentID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to claim task: "+err.Error())
		return
	}

	if task == nil {
		writeJSON(w, http.StatusOK, map[string]any{"task": nil})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"task": taskToResponse(*task)})
}

// ListPendingTasks returns queued/dispatched tasks for an agent.
func (h *Handler) ListPendingTasks(w http.ResponseWriter, r *http.Request) {
	agentID := chi.URLParam(r, "agentId")

	tasks, err := h.Queries.ListPendingTasks(r.Context(), parseUUID(agentID))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list pending tasks")
		return
	}

	resp := make([]AgentTaskResponse, len(tasks))
	for i, t := range tasks {
		resp[i] = taskToResponse(t)
	}

	writeJSON(w, http.StatusOK, resp)
}

// StartTask marks a dispatched task as running.
func (h *Handler) StartTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")

	task, err := h.TaskService.StartTask(r.Context(), parseUUID(taskID))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, taskToResponse(*task))
}

// ReportTaskProgress broadcasts a progress update.
type TaskProgressRequest struct {
	Summary string `json:"summary"`
	Step    int    `json:"step"`
	Total   int    `json:"total"`
}

func (h *Handler) ReportTaskProgress(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")

	var req TaskProgressRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	h.TaskService.ReportProgress(taskID, req.Summary, req.Step, req.Total)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// CompleteTask marks a running task as completed.
type TaskCompleteRequest struct {
	PRURL  string `json:"pr_url"`
	Output string `json:"output"`
}

func (h *Handler) CompleteTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")

	var req TaskCompleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, _ := json.Marshal(req)
	task, err := h.TaskService.CompleteTask(r.Context(), parseUUID(taskID), result)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, taskToResponse(*task))
}

// FailTask marks a running task as failed.
type TaskFailRequest struct {
	Error string `json:"error"`
}

func (h *Handler) FailTask(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")

	var req TaskFailRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	task, err := h.TaskService.FailTask(r.Context(), parseUUID(taskID), req.Error)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, taskToResponse(*task))
}
