-- last_extracted_utc: 2026-03-08T12:31:53.588156Z
-- source_url: https://ros-link.lawsociety.com.au/api/lawyer/, https://www.findaconveyancer.com.au/find-a-conveyancer/, https://www.findaconveyancer.com.au/wp-admin/admin-ajax.php, https://www.findaconveyancer.com.au/wp-json/wp/v2/wpsl_stores, https://www.lawsociety.com.au/register-of-solicitors

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
