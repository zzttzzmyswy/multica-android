package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/internal/realtime"
	"github.com/multica-ai/multica/server/internal/util"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

type TaskService struct {
	Queries *db.Queries
	Hub     *realtime.Hub
}

func NewTaskService(q *db.Queries, hub *realtime.Hub) *TaskService {
	return &TaskService{Queries: q, Hub: hub}
}

// EnqueueTaskForIssue creates a task with a context snapshot of the issue.
func (s *TaskService) EnqueueTaskForIssue(ctx context.Context, issue db.Issue) (db.AgentTaskQueue, error) {
	if !issue.AssigneeID.Valid {
		return db.AgentTaskQueue{}, fmt.Errorf("issue has no assignee")
	}

	snapshot := buildContextSnapshot(issue)
	contextJSON, _ := json.Marshal(snapshot)

	task, err := s.Queries.CreateAgentTaskWithContext(ctx, db.CreateAgentTaskWithContextParams{
		AgentID:  issue.AssigneeID,
		IssueID:  issue.ID,
		Priority: priorityToInt(issue.Priority),
		Context:  contextJSON,
	})
	if err != nil {
		return db.AgentTaskQueue{}, fmt.Errorf("create task: %w", err)
	}

	return task, nil
}

// CancelTasksForIssue cancels all active tasks for an issue.
func (s *TaskService) CancelTasksForIssue(ctx context.Context, issueID pgtype.UUID) error {
	return s.Queries.CancelAgentTasksByIssue(ctx, issueID)
}

// ClaimTask atomically claims the next queued task for an agent,
// respecting max_concurrent_tasks.
func (s *TaskService) ClaimTask(ctx context.Context, agentID pgtype.UUID) (*db.AgentTaskQueue, error) {
	agent, err := s.Queries.GetAgent(ctx, agentID)
	if err != nil {
		return nil, fmt.Errorf("agent not found: %w", err)
	}

	running, err := s.Queries.CountRunningTasks(ctx, agentID)
	if err != nil {
		return nil, fmt.Errorf("count running tasks: %w", err)
	}
	if running >= int64(agent.MaxConcurrentTasks) {
		return nil, nil // No capacity
	}

	task, err := s.Queries.ClaimAgentTask(ctx, agentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil // No tasks available
		}
		return nil, fmt.Errorf("claim task: %w", err)
	}

	// Update agent status to working
	s.updateAgentStatus(ctx, agentID, "working")

	// Broadcast task:dispatch
	s.broadcastTaskDispatch(task)

	return &task, nil
}

// StartTask transitions a dispatched task to running and syncs issue status.
func (s *TaskService) StartTask(ctx context.Context, taskID pgtype.UUID) (*db.AgentTaskQueue, error) {
	task, err := s.Queries.StartAgentTask(ctx, taskID)
	if err != nil {
		return nil, fmt.Errorf("start task: %w", err)
	}

	// Sync issue → in_progress
	s.Queries.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
		ID:     task.IssueID,
		Status: "in_progress",
	})

	return &task, nil
}

// CompleteTask marks a task as completed and syncs issue/agent status.
func (s *TaskService) CompleteTask(ctx context.Context, taskID pgtype.UUID, result []byte) (*db.AgentTaskQueue, error) {
	task, err := s.Queries.CompleteAgentTask(ctx, db.CompleteAgentTaskParams{
		ID:     taskID,
		Result: result,
	})
	if err != nil {
		return nil, fmt.Errorf("complete task: %w", err)
	}

	// Sync issue → in_review
	s.Queries.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
		ID:     task.IssueID,
		Status: "in_review",
	})

	// Reconcile agent status
	s.ReconcileAgentStatus(ctx, task.AgentID)

	// Broadcast
	s.broadcastTaskEvent(protocol.EventTaskCompleted, task)

	return &task, nil
}

// FailTask marks a task as failed and syncs issue/agent status.
func (s *TaskService) FailTask(ctx context.Context, taskID pgtype.UUID, errMsg string) (*db.AgentTaskQueue, error) {
	task, err := s.Queries.FailAgentTask(ctx, db.FailAgentTaskParams{
		ID:    taskID,
		Error: pgtype.Text{String: errMsg, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("fail task: %w", err)
	}

	// Sync issue → blocked
	s.Queries.UpdateIssueStatus(ctx, db.UpdateIssueStatusParams{
		ID:     task.IssueID,
		Status: "blocked",
	})

	// Reconcile agent status
	s.ReconcileAgentStatus(ctx, task.AgentID)

	// Broadcast
	s.broadcastTaskEvent(protocol.EventTaskFailed, task)

	return &task, nil
}

// ReportProgress broadcasts a progress update via WebSocket.
func (s *TaskService) ReportProgress(taskID string, summary string, step, total int) {
	s.broadcast(protocol.EventTaskProgress, protocol.TaskProgressPayload{
		TaskID:  taskID,
		Summary: summary,
		Step:    step,
		Total:   total,
	})
}

// ReconcileAgentStatus checks running task count and sets agent status accordingly.
func (s *TaskService) ReconcileAgentStatus(ctx context.Context, agentID pgtype.UUID) {
	running, err := s.Queries.CountRunningTasks(ctx, agentID)
	if err != nil {
		return
	}
	newStatus := "idle"
	if running > 0 {
		newStatus = "working"
	}
	s.updateAgentStatus(ctx, agentID, newStatus)
}

func (s *TaskService) updateAgentStatus(ctx context.Context, agentID pgtype.UUID, status string) {
	agent, err := s.Queries.UpdateAgentStatus(ctx, db.UpdateAgentStatusParams{
		ID:     agentID,
		Status: status,
	})
	if err != nil {
		return
	}
	s.broadcast(protocol.EventAgentStatus, map[string]any{"agent": agentToMap(agent)})
}

func buildContextSnapshot(issue db.Issue) protocol.TaskDispatchPayload {
	var ac []string
	if issue.AcceptanceCriteria != nil {
		json.Unmarshal(issue.AcceptanceCriteria, &ac)
	}
	var cr []string
	if issue.ContextRefs != nil {
		json.Unmarshal(issue.ContextRefs, &cr)
	}
	var repo *protocol.RepoRef
	if issue.Repository != nil {
		repo = &protocol.RepoRef{}
		json.Unmarshal(issue.Repository, repo)
	}

	return protocol.TaskDispatchPayload{
		IssueID:            util.UUIDToString(issue.ID),
		Title:              issue.Title,
		Description:        issue.Description.String,
		AcceptanceCriteria: ac,
		ContextRefs:        cr,
		Repository:         repo,
	}
}

func priorityToInt(p string) int32 {
	switch p {
	case "urgent":
		return 4
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}

func (s *TaskService) broadcastTaskDispatch(task db.AgentTaskQueue) {
	var payload protocol.TaskDispatchPayload
	if task.Context != nil {
		json.Unmarshal(task.Context, &payload)
	}
	payload.TaskID = util.UUIDToString(task.ID)
	s.broadcast(protocol.EventTaskDispatch, payload)
}

func (s *TaskService) broadcastTaskEvent(eventType string, task db.AgentTaskQueue) {
	s.broadcast(eventType, map[string]any{
		"task_id":  util.UUIDToString(task.ID),
		"agent_id": util.UUIDToString(task.AgentID),
		"issue_id": util.UUIDToString(task.IssueID),
		"status":   task.Status,
	})
}

func (s *TaskService) broadcast(eventType string, payload any) {
	msg := map[string]any{
		"type":    eventType,
		"payload": payload,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	s.Hub.Broadcast(data)
}

// agentToMap builds a simple map for broadcasting agent status updates.
func agentToMap(a db.Agent) map[string]any {
	var rc any
	if a.RuntimeConfig != nil {
		json.Unmarshal(a.RuntimeConfig, &rc)
	}
	var tools any
	if a.Tools != nil {
		json.Unmarshal(a.Tools, &tools)
	}
	var triggers any
	if a.Triggers != nil {
		json.Unmarshal(a.Triggers, &triggers)
	}
	return map[string]any{
		"id":                   util.UUIDToString(a.ID),
		"workspace_id":         util.UUIDToString(a.WorkspaceID),
		"name":                 a.Name,
		"description":          a.Description,
		"avatar_url":           util.TextToPtr(a.AvatarUrl),
		"runtime_mode":         a.RuntimeMode,
		"runtime_config":       rc,
		"visibility":           a.Visibility,
		"status":               a.Status,
		"max_concurrent_tasks": a.MaxConcurrentTasks,
		"owner_id":             util.UUIDToPtr(a.OwnerID),
		"skills":               a.Skills,
		"tools":                tools,
		"triggers":             triggers,
		"created_at":           util.TimestampToString(a.CreatedAt),
		"updated_at":           util.TimestampToString(a.UpdatedAt),
	}
}
