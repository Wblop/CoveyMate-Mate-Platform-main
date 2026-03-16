CREATE TABLE IF NOT EXISTS app.review_jobs
(
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    property_address TEXT NOT NULL,
    buyer_type TEXT NOT NULL,
    status TEXT NOT NULL,
    payment_status TEXT NOT NULL,
    stripe_payment_intent_id TEXT UNIQUE,
    amount_aud_cents INTEGER NOT NULL DEFAULT 1999,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    payment_confirmed_at TIMESTAMPTZ NULL,
    queued_at TIMESTAMPTZ NULL,
    error_message TEXT NULL,
    report_s3_key TEXT NULL,
    progress_json JSONB NOT NULL DEFAULT '{"percent":0,"currentStep":"AwaitingUpload"}'::JSONB,
    summary_json JSONB NULL
);

CREATE INDEX IF NOT EXISTS ix_review_jobs_user_id ON app.review_jobs (user_id);
CREATE INDEX IF NOT EXISTS ix_review_jobs_user_status ON app.review_jobs (user_id, status);
CREATE INDEX IF NOT EXISTS ix_review_jobs_created_at ON app.review_jobs (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_review_jobs_payment_intent
    ON app.review_jobs (stripe_payment_intent_id)
    WHERE stripe_payment_intent_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_review_jobs_set_updated_at ON app.review_jobs;
CREATE TRIGGER trg_review_jobs_set_updated_at
    BEFORE UPDATE
    ON app.review_jobs
    FOR EACH ROW
EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS app.job_documents
(
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES app.review_jobs (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    s3_key_raw TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_job_documents_job_id ON app.job_documents (job_id);
CREATE INDEX IF NOT EXISTS ix_job_documents_user_id ON app.job_documents (user_id);

CREATE TABLE IF NOT EXISTS app.extracted_chunks
(
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES app.review_jobs (id) ON DELETE CASCADE,
    doc_id UUID NOT NULL REFERENCES app.job_documents (id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    section_heading TEXT NULL,
    clause_ref TEXT NULL,
    content_text TEXT NOT NULL,
    bbox_json JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_extracted_chunks_job_id ON app.extracted_chunks (job_id);
CREATE INDEX IF NOT EXISTS ix_extracted_chunks_doc_id ON app.extracted_chunks (doc_id);
CREATE INDEX IF NOT EXISTS ix_extracted_chunks_page ON app.extracted_chunks (job_id, page_number);

CREATE TABLE IF NOT EXISTS app.citations
(
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES app.review_jobs (id) ON DELETE CASCADE,
    chunk_id BIGINT NOT NULL REFERENCES app.extracted_chunks (id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    quote_snippet TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_citations_job_id ON app.citations (job_id);
CREATE INDEX IF NOT EXISTS ix_citations_chunk_id ON app.citations (chunk_id);

CREATE TABLE IF NOT EXISTS app.embeddings
(
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES app.review_jobs (id) ON DELETE CASCADE,
    chunk_id BIGINT NOT NULL REFERENCES app.extracted_chunks (id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    embedding_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_embeddings_chunk_id ON app.embeddings (chunk_id);
CREATE INDEX IF NOT EXISTS ix_embeddings_job_id ON app.embeddings (job_id);

DO
$$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
        BEGIN
            CREATE EXTENSION IF NOT EXISTS vector;
        EXCEPTION
            WHEN insufficient_privilege THEN
                RAISE NOTICE 'pgvector extension could not be created due to insufficient privileges. Falling back to JSON-only embeddings.';
        END;
    ELSE
        RAISE NOTICE 'pgvector extension is not installed on this PostgreSQL server. Falling back to JSON-only embeddings.';
    END IF;
END
$$;

DO
$$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        EXECUTE 'ALTER TABLE app.embeddings ADD COLUMN IF NOT EXISTS embedding VECTOR(384)';
        EXECUTE 'CREATE INDEX IF NOT EXISTS ix_embeddings_vector_cosine ON app.embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS app.stripe_webhook_events
(
    event_id TEXT PRIMARY KEY,
    payment_intent_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_stripe_webhook_payment_intent ON app.stripe_webhook_events (payment_intent_id);
