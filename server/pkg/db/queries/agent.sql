-- name: ListAgents :many
SELECT * FROM agent
WHERE workspace_id = $1
ORDER BY created_at ASC;

-- name: GetAgent :one
SELECT * FROM agent
WHERE id = $1;

-- name: CreateAgent :one
INSERT INTO agent (
    workspace_id, name, description, avatar_url, runtime_mode,
    runtime_config, visibility, max_concurrent_tasks, owner_id,
    skills, tools, triggers
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING *;

-- name: UpdateAgent :one
UPDATE agent SET
    name = COALESCE(sqlc.narg('name'), name),
    description = COALESCE(sqlc.narg('description'), description),
    avatar_url = COALESCE(sqlc.narg('avatar_url'), avatar_url),
    runtime_config = COALESCE(sqlc.narg('runtime_config'), runtime_config),
    visibility = COALESCE(sqlc.narg('visibility'), visibility),
    status = COALESCE(sqlc.narg('status'), status),
    max_concurrent_tasks = COALESCE(sqlc.narg('max_concurrent_tasks'), max_concurrent_tasks),
    skills = COALESCE(sqlc.narg('skills'), skills),
    tools = COALESCE(sqlc.narg('tools'), tools),
    triggers = COALESCE(sqlc.narg('triggers'), triggers),
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteAgent :exec
DELETE FROM agent WHERE id = $1;

-- name: ListAgentTasks :many
SELECT * FROM agent_task_queue
WHERE agent_id = $1
ORDER BY created_at DESC;

-- name: CreateAgentTask :one
INSERT INTO agent_task_queue (agent_id, issue_id, status, priority)
VALUES ($1, $2, 'queued', $3)
RETURNING *;

-- name: CancelAgentTasksByIssue :exec
UPDATE agent_task_queue
SET status = 'cancelled'
WHERE issue_id = $1 AND status IN ('queued', 'dispatched', 'running');

-- name: GetAgentTask :one
SELECT * FROM agent_task_queue
WHERE id = $1;

-- name: CreateAgentTaskWithContext :one
INSERT INTO agent_task_queue (agent_id, issue_id, status, priority, context)
VALUES ($1, $2, 'queued', $3, $4)
RETURNING *;

-- name: ClaimAgentTask :one
UPDATE agent_task_queue
SET status = 'dispatched', dispatched_at = now()
WHERE id = (
    SELECT atq.id FROM agent_task_queue atq
    WHERE atq.agent_id = $1 AND atq.status = 'queued'
    ORDER BY atq.priority DESC, atq.created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: StartAgentTask :one
UPDATE agent_task_queue
SET status = 'running', started_at = now()
WHERE id = $1 AND status = 'dispatched'
RETURNING *;

-- name: CompleteAgentTask :one
UPDATE agent_task_queue
SET status = 'completed', completed_at = now(), result = $2
WHERE id = $1 AND status = 'running'
RETURNING *;

-- name: FailAgentTask :one
UPDATE agent_task_queue
SET status = 'failed', completed_at = now(), error = $2
WHERE id = $1 AND status = 'running'
RETURNING *;

-- name: CountRunningTasks :one
SELECT count(*) FROM agent_task_queue
WHERE agent_id = $1 AND status IN ('dispatched', 'running');

-- name: ListPendingTasks :many
SELECT * FROM agent_task_queue
WHERE agent_id = $1 AND status IN ('queued', 'dispatched')
ORDER BY priority DESC, created_at ASC;

-- name: UpdateAgentStatus :one
UPDATE agent SET status = $2, updated_at = now()
WHERE id = $1
RETURNING *;

-- name: UpsertDaemonConnection :one
INSERT INTO daemon_connection (agent_id, daemon_id, status, last_heartbeat_at, runtime_info)
VALUES ($1, $2, 'connected', now(), $3)
ON CONFLICT ON CONSTRAINT uq_daemon_agent
DO UPDATE SET status = 'connected', last_heartbeat_at = now(), runtime_info = $3, updated_at = now()
RETURNING *;

-- name: UpdateDaemonHeartbeat :exec
UPDATE daemon_connection
SET last_heartbeat_at = now(), updated_at = now()
WHERE daemon_id = $1 AND agent_id = $2;

-- name: DisconnectDaemon :exec
UPDATE daemon_connection
SET status = 'disconnected', updated_at = now()
WHERE daemon_id = $1;
