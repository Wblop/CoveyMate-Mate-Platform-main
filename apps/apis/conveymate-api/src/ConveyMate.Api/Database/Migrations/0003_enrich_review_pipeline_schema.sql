ALTER TABLE app.review_jobs
    ADD COLUMN IF NOT EXISTS state_or_territory TEXT NOT NULL DEFAULT 'ACT',
    ADD COLUMN IF NOT EXISTS local_government_area TEXT NULL,
    ADD COLUMN IF NOT EXISTS property_tenure_type TEXT NOT NULL DEFAULT 'Unknown',
    ADD COLUMN IF NOT EXISTS pack_type TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS contract_facts_json JSONB NULL,
    ADD COLUMN IF NOT EXISTS jurisdiction_profile_json JSONB NULL,
    ADD COLUMN IF NOT EXISTS enrichment_json JSONB NULL,
    ADD COLUMN IF NOT EXISTS geo_context_json JSONB NULL;

UPDATE app.review_jobs
SET progress_json = jsonb_set(
        jsonb_set(
            jsonb_set(COALESCE(progress_json, '{}'::jsonb), '{percent}', COALESCE(progress_json -> 'percent', '0'::jsonb), true),
            '{currentStep}', to_jsonb(COALESCE(progress_json ->> 'currentStep', status)), true),
        '{currentSubStep}', to_jsonb(COALESCE(progress_json ->> 'currentSubStep', '')), true)
WHERE progress_json IS NOT NULL
  AND (
    NOT (progress_json ? 'currentSubStep')
        OR NOT (progress_json ? 'lastUpdatedUtc'));

UPDATE app.review_jobs
SET progress_json = jsonb_set(
        COALESCE(progress_json, '{}'::jsonb),
        '{lastUpdatedUtc}',
        to_jsonb(COALESCE(progress_json ->> 'lastUpdatedUtc', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
        true)
WHERE progress_json IS NOT NULL;

ALTER TABLE app.review_jobs
    ALTER COLUMN progress_json
        SET DEFAULT '{"percent":0,"currentStep":"AwaitingUpload","currentSubStep":"Awaiting upload","lastUpdatedUtc":"1970-01-01T00:00:00Z"}'::jsonb;

CREATE INDEX IF NOT EXISTS ix_review_jobs_state ON app.review_jobs (state_or_territory);
CREATE INDEX IF NOT EXISTS ix_review_jobs_pack_type ON app.review_jobs (pack_type);

ALTER TABLE app.job_documents
    ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS page_count INTEGER NULL,
    ADD COLUMN IF NOT EXISTS extraction_mode TEXT NULL;

CREATE INDEX IF NOT EXISTS ix_job_documents_doc_type ON app.job_documents (job_id, doc_type);

ALTER TABLE app.extracted_chunks
    ADD COLUMN IF NOT EXISTS chunk_kind TEXT NOT NULL DEFAULT 'paragraph',
    ADD COLUMN IF NOT EXISTS content_hash TEXT NULL;

CREATE INDEX IF NOT EXISTS ix_extracted_chunks_kind ON app.extracted_chunks (job_id, chunk_kind);

ALTER TABLE app.embeddings
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'xai';

DO
$$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
        BEGIN
            CREATE EXTENSION IF NOT EXISTS vector;
        EXCEPTION
            WHEN insufficient_privilege THEN
                RAISE NOTICE 'pgvector extension could not be created due to insufficient privileges.';
        END;
    END IF;
END
$$;

DO
$$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        EXECUTE 'ALTER TABLE app.embeddings ADD COLUMN IF NOT EXISTS embedding_v2 VECTOR(1536)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS ix_embeddings_vector_cosine_v2 ON app.embeddings USING ivfflat (embedding_v2 vector_cosine_ops) WITH (lists = 100)';
    END IF;
END
$$;
