CREATE TABLE IF NOT EXISTS app.feedback
(
    id         UUID        PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    type       TEXT        NOT NULL,
    message    TEXT        NOT NULL,
    page_url   TEXT        NOT NULL,
    user_agent TEXT        NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_feedback_user_id ON app.feedback (user_id);
CREATE INDEX IF NOT EXISTS ix_feedback_created_at ON app.feedback (created_at DESC);
