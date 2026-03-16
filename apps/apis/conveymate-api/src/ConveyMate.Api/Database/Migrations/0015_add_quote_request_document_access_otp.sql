ALTER TABLE app.quote_request_targets
    ADD COLUMN IF NOT EXISTS document_access_otp_hash TEXT NULL,
    ADD COLUMN IF NOT EXISTS document_access_otp_requested_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS document_access_otp_expires_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS document_access_otp_send_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS document_access_verified_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS app.quote_request_document_access_sessions
(
    id                UUID        PRIMARY KEY,
    target_id         UUID        NOT NULL REFERENCES app.quote_request_targets (id) ON DELETE CASCADE,
    access_token_hash TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ NOT NULL,
    revoked_at        TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_quote_request_document_access_sessions_token_hash
    ON app.quote_request_document_access_sessions (access_token_hash);

CREATE INDEX IF NOT EXISTS ix_quote_request_document_access_sessions_target_id
    ON app.quote_request_document_access_sessions (target_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS app.quote_request_document_downloads
(
    id                  UUID        PRIMARY KEY,
    target_id           UUID        NOT NULL REFERENCES app.quote_request_targets (id) ON DELETE CASCADE,
    document_key        TEXT        NOT NULL,
    document_kind       TEXT        NOT NULL,
    document_id         UUID        NULL,
    file_name           TEXT        NOT NULL,
    first_downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_downloaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    download_count      INTEGER     NOT NULL DEFAULT 1,
    CONSTRAINT ck_quote_request_document_downloads_kind
        CHECK (document_kind IN ('report', 'job-document')),
    CONSTRAINT ck_quote_request_document_downloads_count
        CHECK (download_count > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_quote_request_document_downloads_target_key
    ON app.quote_request_document_downloads (target_id, document_key);

CREATE INDEX IF NOT EXISTS ix_quote_request_document_downloads_target_last_downloaded
    ON app.quote_request_document_downloads (target_id, last_downloaded_at DESC);
