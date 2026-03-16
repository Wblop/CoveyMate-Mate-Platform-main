-- last_extracted_utc: 2026-03-06T05:21:41.166269Z
-- source_url: https://www.youandthelaw.com.au/directory

CREATE SCHEMA IF NOT EXISTS app;

DROP TABLE IF EXISTS app.conveyancer_refresh_log;
CREATE TABLE app.conveyancer_refresh_log
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

CREATE INDEX ix_conveyancer_refresh_log_started_utc
    ON app.conveyancer_refresh_log (started_utc DESC);
