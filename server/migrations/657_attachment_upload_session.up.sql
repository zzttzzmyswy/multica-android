-- Upload sessions for presigned direct-to-object-storage attachments.
--
-- A row is the server's record of one "issue a PUT credential" decision: who
-- may upload, to which staging key, for which target, with what declared size,
-- and until when. The object written by the client lands on staging_key; the
-- attachment published by complete-upload lives on a DIFFERENT final_key that
-- no client credential can write, so a still-valid presigned URL cannot change
-- the bytes of a published attachment.
--
-- Why a separate table instead of a pending row in `attachment`: every read
-- path (issue attachment lists, chat bubbles, project visibility, search
-- snippets, GC) selects `attachment` unconditionally, so a half-finished
-- upload living there would either need a new predicate in all of them or leak
-- into responses. This table is invisible to every one of them; the attachment
-- row is only written inside the completing transaction.
--
-- State machine:
--   pending   → credential issued; the client may still be PUTting. Only a
--               complete-upload under this row's lock may publish it.
--   completed → the attachment row exists. The row survives only to drive
--               staging-object cleanup, then the reconciler deletes it.
--   deleting  → the reconciler holds a lease and is removing the objects.
--   tombstoned→ objects were deleted, but the row is kept so a late PUT that
--               materializes after the delete is re-deleted on a widening
--               schedule (a DELETE cannot be ordered against a PUT the client
--               already abandoned; see channel_media_pending_object, whose
--               ledger this reuses the shape of).
--
-- `id` is also the attachment id the response reports and the complete-upload
-- path parameter, so the client never has to correlate two identifiers.
--
-- No foreign keys (repo rule). Targets are re-validated inside the completing
-- transaction; a target that disappeared while the bytes uploaded is refused
-- rather than left as a dangling reference. Workspace teardown releases the
-- rows to the reconciler in application code.
CREATE TABLE IF NOT EXISTS attachment_upload_session (
    id                    UUID PRIMARY KEY,
    workspace_id          UUID NOT NULL,
    -- Actor is what the attachment row will record (member or agent), while
    -- actor_user_id is the authenticated user behind it — an agent acts on
    -- behalf of the member whose token scope authorized the run.
    actor_type            TEXT NOT NULL CHECK (actor_type IN ('member', 'agent')),
    actor_id              UUID NOT NULL,
    actor_user_id         UUID NOT NULL,
    issue_id              UUID,
    comment_id            UUID,
    chat_session_id       UUID,
    task_id               UUID,
    filename              TEXT NOT NULL,
    -- What the client declared. Only used to sign the PUT and to reject an
    -- obviously wrong request; the published content type is sniffed from the
    -- stored bytes because a HEAD/PUT header is client-controlled.
    declared_content_type TEXT NOT NULL,
    expected_size         BIGINT NOT NULL,
    staging_key           TEXT NOT NULL,
    final_key             TEXT NOT NULL,
    state                 TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'completed', 'deleting', 'tombstoned')),
    attachment_id         UUID,
    -- Reconciler bookkeeping, mirroring channel_media_pending_object: a lease
    -- so two replicas do not delete the same session concurrently, a retry
    -- backoff for object-storage failures, and a tombstone pass for late PUTs.
    lease_token           UUID,
    lease_expires_at      TIMESTAMPTZ,
    attempt               INT NOT NULL DEFAULT 0,
    next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error            TEXT,
    tombstone_pass        INT NOT NULL DEFAULT 0,
    -- When the presigned PUT stops being valid. The reconciler waits an extra
    -- settle window past this before touching a pending session's objects.
    expires_at            TIMESTAMPTZ NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at          TIMESTAMPTZ
);
