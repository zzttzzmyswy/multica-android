-- name: ListComments :many
SELECT * FROM comment
WHERE issue_id = $1
ORDER BY created_at ASC;

-- name: GetComment :one
SELECT * FROM comment
WHERE id = $1;

-- name: CreateComment :one
INSERT INTO comment (issue_id, author_type, author_id, content, type)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateComment :one
UPDATE comment SET
    content = $2,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteComment :exec
DELETE FROM comment WHERE id = $1;
