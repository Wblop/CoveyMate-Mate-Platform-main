CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.users
(
    id UUID PRIMARY KEY,
    cognito_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_cognito_sub ON app.users (cognito_sub);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON app.users (email);

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS
$$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON app.users;
CREATE TRIGGER trg_users_set_updated_at
    BEFORE UPDATE
    ON app.users
    FOR EACH ROW
EXECUTE FUNCTION app.set_updated_at();
