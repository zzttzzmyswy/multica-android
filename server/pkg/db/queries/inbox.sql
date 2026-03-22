-- name: ListInboxItems :many
SELECT * FROM inbox_item
WHERE recipient_type = $1 AND recipient_id = $2 AND archived = false
ORDER BY created_at DESC
LIMIT $3 OFFSET $4;

-- name: GetInboxItem :one
SELECT * FROM inbox_item
WHERE id = $1;

-- name: CreateInboxItem :one
INSERT INTO inbox_item (
    workspace_id, recipient_type, recipient_id,
    type, severity, issue_id, title, body
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: MarkInboxRead :one
UPDATE inbox_item SET read = true
WHERE id = $1
RETURNING *;

-- name: ArchiveInboxItem :one
UPDATE inbox_item SET archived = true
WHERE id = $1
RETURNING *;

-- name: CountUnreadInbox :one
SELECT count(*) FROM inbox_item
WHERE recipient_type = $1 AND recipient_id = $2 AND read = false AND archived = false;
