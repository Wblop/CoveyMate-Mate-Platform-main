CREATE INDEX IF NOT EXISTS ix_feedback_created_at_id
    ON app.feedback (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_feedback_type_created_at_id
    ON app.feedback (type, created_at DESC, id DESC);
