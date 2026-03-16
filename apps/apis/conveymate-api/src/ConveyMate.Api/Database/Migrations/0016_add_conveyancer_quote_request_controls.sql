ALTER TABLE app.conveyancers
    ADD COLUMN IF NOT EXISTS quote_requests_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE app.conveyancers
    ADD COLUMN IF NOT EXISTS quote_requests_disabled_utc TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS ix_conveyancers_jurisdiction_active_quote_requests
    ON app.conveyancers (jurisdiction, is_active, quote_requests_enabled, organization_name, name);
