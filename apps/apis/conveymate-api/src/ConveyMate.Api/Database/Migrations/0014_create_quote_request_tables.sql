CREATE TABLE IF NOT EXISTS app.quote_requests
(
    id               UUID        PRIMARY KEY,
    user_id          UUID        NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
    review_job_id    UUID        NOT NULL REFERENCES app.review_jobs (id) ON DELETE CASCADE,
    property_address TEXT        NOT NULL,
    state_or_territory TEXT      NOT NULL,
    service_need     TEXT        NOT NULL,
    message          TEXT        NULL,
    share_report_pdf BOOLEAN     NOT NULL DEFAULT FALSE,
    brief_json       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    status           TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at          TIMESTAMPTZ NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_quote_requests_status
        CHECK (status IN ('open', 'completed', 'cancelled')),
    CONSTRAINT ck_quote_requests_service_need
        CHECK (service_need IN ('pre-exchange-review', 'full-conveyancing', 'settlement-only'))
);

CREATE INDEX IF NOT EXISTS ix_quote_requests_user_created_at
    ON app.quote_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_quote_requests_review_job_id
    ON app.quote_requests (review_job_id);

DROP TRIGGER IF EXISTS trg_quote_requests_set_updated_at ON app.quote_requests;
CREATE TRIGGER trg_quote_requests_set_updated_at
    BEFORE UPDATE
    ON app.quote_requests
    FOR EACH ROW
EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS app.quote_request_targets
(
    id                  UUID        PRIMARY KEY,
    quote_request_id    UUID        NOT NULL REFERENCES app.quote_requests (id) ON DELETE CASCADE,
    jurisdiction        TEXT        NOT NULL,
    regulator_type      TEXT        NOT NULL,
    source_identifier   TEXT        NOT NULL,
    name                TEXT        NOT NULL,
    contact_name        TEXT        NULL,
    organization_name   TEXT        NULL,
    email               TEXT        NOT NULL,
    phone               TEXT        NULL,
    website             TEXT        NULL,
    source_url          TEXT        NOT NULL,
    response_token_hash TEXT        NOT NULL,
    status              TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at             TIMESTAMPTZ NULL,
    opened_at           TIMESTAMPTZ NULL,
    responded_at        TIMESTAMPTZ NULL,
    delivery_error      TEXT        NULL,
    CONSTRAINT ck_quote_request_targets_status
        CHECK (status IN ('prepared', 'sent', 'opened', 'responded', 'delivery-failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_quote_request_targets_request_source
    ON app.quote_request_targets (quote_request_id, jurisdiction, regulator_type, source_identifier);

CREATE UNIQUE INDEX IF NOT EXISTS ux_quote_request_targets_response_token_hash
    ON app.quote_request_targets (response_token_hash);

CREATE INDEX IF NOT EXISTS ix_quote_request_targets_quote_request_id
    ON app.quote_request_targets (quote_request_id, created_at ASC);

CREATE INDEX IF NOT EXISTS ix_quote_request_targets_status
    ON app.quote_request_targets (status, responded_at DESC);

DROP TRIGGER IF EXISTS trg_quote_request_targets_set_updated_at ON app.quote_request_targets;
CREATE TRIGGER trg_quote_request_targets_set_updated_at
    BEFORE UPDATE
    ON app.quote_request_targets
    FOR EACH ROW
EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS app.quote_request_responses
(
    id                         UUID            PRIMARY KEY,
    target_id                  UUID            NOT NULL UNIQUE REFERENCES app.quote_request_targets (id) ON DELETE CASCADE,
    responder_name             TEXT            NOT NULL,
    responder_email            TEXT            NOT NULL,
    responder_phone            TEXT            NULL,
    professional_fee_aud       NUMERIC(12, 2)  NOT NULL,
    includes_gst               BOOLEAN         NOT NULL DEFAULT FALSE,
    disbursements_estimate_aud NUMERIC(12, 2)  NULL,
    turnaround_business_days   INTEGER         NULL,
    scope_notes                TEXT            NOT NULL,
    excluded_items_json        JSONB           NOT NULL DEFAULT '[]'::jsonb,
    valid_until_utc            TIMESTAMPTZ     NULL,
    created_at                 TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_quote_request_responses_professional_fee
        CHECK (professional_fee_aud > 0),
    CONSTRAINT ck_quote_request_responses_disbursements
        CHECK (disbursements_estimate_aud IS NULL OR disbursements_estimate_aud >= 0),
    CONSTRAINT ck_quote_request_responses_turnaround
        CHECK (turnaround_business_days IS NULL OR turnaround_business_days > 0)
);

CREATE INDEX IF NOT EXISTS ix_quote_request_responses_created_at
    ON app.quote_request_responses (created_at DESC);

DROP TRIGGER IF EXISTS trg_quote_request_responses_set_updated_at ON app.quote_request_responses;
CREATE TRIGGER trg_quote_request_responses_set_updated_at
    BEFORE UPDATE
    ON app.quote_request_responses
    FOR EACH ROW
EXECUTE FUNCTION app.set_updated_at();
