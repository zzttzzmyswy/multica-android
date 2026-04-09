-- GIN index on comment content for LIKE '%keyword%' queries (pg_bigm).
CREATE INDEX idx_comment_content_bigm ON comment USING gin (content gin_bigm_ops);
