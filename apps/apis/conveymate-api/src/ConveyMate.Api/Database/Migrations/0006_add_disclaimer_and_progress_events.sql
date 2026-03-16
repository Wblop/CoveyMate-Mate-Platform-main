ALTER TABLE app.review_jobs
    ADD COLUMN IF NOT EXISTS disclaimer_version TEXT NULL,
    ADD COLUMN IF NOT EXISTS disclaimer_accepted_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS app.review_job_progress_events
(
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES app.review_jobs (id) ON DELETE CASCADE,
    stage_id TEXT NOT NULL,
    stage_state TEXT NOT NULL DEFAULT 'queued',
    severity TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    percent INTEGER NULL,
    detail_code TEXT NULL,
    attempt INTEGER NULL,
    max_attempts INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_review_job_progress_events_job_id_created_at
    ON app.review_job_progress_events (job_id, created_at ASC, id ASC);

INSERT INTO app.review_job_progress_events
(
    job_id,
    stage_id,
    stage_state,
    severity,
    message,
    percent,
    detail_code,
    created_at
)
SELECT jobs.id,
       COALESCE(jobs.progress_json ->> 'currentStep', jobs.status),
       CASE LOWER(COALESCE(jobs.progress_json ->> 'currentStep', jobs.status))
           WHEN 'extracting' THEN 'running'
           WHEN 'indexing' THEN 'running'
           WHEN 'analyzing' THEN 'running'
           WHEN 'validating' THEN 'running'
           WHEN 'rendering' THEN 'running'
           WHEN 'completed' THEN 'complete'
           WHEN 'failed' THEN 'failed'
           ELSE 'queued'
           END,
       CASE WHEN LOWER(jobs.status) = 'failed' THEN 'error' ELSE 'info' END,
       COALESCE(NULLIF(jobs.progress_json ->> 'currentSubStep', ''), 'Progress update.'),
       CASE
           WHEN (jobs.progress_json ->> 'percent') ~ '^[0-9]+$'
               THEN CAST(jobs.progress_json ->> 'percent' AS integer)
           ELSE NULL
           END,
       'migration_backfill',
       COALESCE(jobs.updated_at, jobs.created_at, NOW())
FROM app.review_jobs jobs
WHERE NOT EXISTS (
    SELECT 1
    FROM app.review_job_progress_events events
    WHERE events.job_id = jobs.id
);
