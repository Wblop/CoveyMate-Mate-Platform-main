CREATE TABLE IF NOT EXISTS app.conveyancers
(
    id UUID PRIMARY KEY,
    jurisdiction TEXT NOT NULL,
    regulator_type TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT NULL,
    phone TEXT NULL,
    email TEXT NULL,
    website TEXT NULL,
    areas_of_practice JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_url TEXT NOT NULL,
    source_identifier TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_utc TIMESTAMPTZ NOT NULL,
    created_utc TIMESTAMPTZ NOT NULL,
    updated_utc TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_conveyancers_jurisdiction_regulator_source
    ON app.conveyancers (jurisdiction, regulator_type, source_identifier);

CREATE INDEX IF NOT EXISTS ix_conveyancers_jurisdiction_active_name
    ON app.conveyancers (jurisdiction, is_active, name);

CREATE TABLE IF NOT EXISTS app.conveyancer_refresh_log
(
    id UUID PRIMARY KEY,
    jurisdiction TEXT NULL,
    regulator_type TEXT NULL,
    started_utc TIMESTAMPTZ NULL,
    completed_utc TIMESTAMPTZ NULL,
    status TEXT NULL,
    record_count INTEGER NULL,
    error_message TEXT NULL,
    extracted_sql_path TEXT NULL
);

CREATE INDEX IF NOT EXISTS ix_conveyancer_refresh_log_started_utc
    ON app.conveyancer_refresh_log (started_utc DESC);
