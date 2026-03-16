ALTER TABLE app.review_jobs
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

ALTER TABLE app.quote_requests
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_review_jobs_user_archived_created_at
    ON app.review_jobs (user_id, archived_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_requests_user_archived_created_at
    ON app.quote_requests (user_id, archived_at, created_at DESC);
