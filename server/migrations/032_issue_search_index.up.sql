-- Enable pg_bigm extension for bigram-based full-text search (CJK-friendly).
CREATE EXTENSION IF NOT EXISTS pg_bigm;

-- GIN index on issue title for LIKE '%keyword%' queries.
CREATE INDEX idx_issue_title_bigm ON issue USING gin (title gin_bigm_ops);

-- GIN index on issue description (nullable, use COALESCE).
CREATE INDEX idx_issue_description_bigm ON issue USING gin (COALESCE(description, '') gin_bigm_ops);
