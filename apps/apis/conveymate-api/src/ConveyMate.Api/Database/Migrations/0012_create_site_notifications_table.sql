CREATE TABLE IF NOT EXISTS app.site_notifications
(
    id         UUID        PRIMARY KEY,
    message    TEXT        NOT NULL,
    tone       TEXT        NOT NULL,
    audience   TEXT        NOT NULL,
    is_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_site_notifications_tone
        CHECK (tone IN ('info', 'warning')),
    CONSTRAINT ck_site_notifications_audience
        CHECK (audience IN ('public', 'dashboard', 'both'))
);

CREATE INDEX IF NOT EXISTS ix_site_notifications_enabled_audience_created_at
    ON app.site_notifications (is_enabled, audience, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_site_notifications_created_at
    ON app.site_notifications (created_at DESC);

DROP TRIGGER IF EXISTS trg_site_notifications_set_updated_at ON app.site_notifications;
CREATE TRIGGER trg_site_notifications_set_updated_at
    BEFORE UPDATE
    ON app.site_notifications
    FOR EACH ROW
EXECUTE FUNCTION app.set_updated_at();
