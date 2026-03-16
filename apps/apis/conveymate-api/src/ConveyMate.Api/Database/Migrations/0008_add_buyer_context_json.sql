ALTER TABLE app.review_jobs
    ADD COLUMN IF NOT EXISTS buyer_context_json JSONB NULL;
