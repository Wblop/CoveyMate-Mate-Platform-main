ALTER TABLE app.users
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS app.admin_users
(
    email TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seeds me as a user regardless of deployment
INSERT INTO app.admin_users (email)
VALUES ('daimenrees@hotmail.com')
ON CONFLICT (email) DO NOTHING;

UPDATE app.users AS users
SET is_admin = TRUE,
    updated_at = NOW()
WHERE EXISTS (
    SELECT 1
    FROM app.admin_users AS admin_users
    WHERE LOWER(admin_users.email) = LOWER(users.email)
);

CREATE INDEX IF NOT EXISTS ix_users_is_admin ON app.users (is_admin);
CREATE INDEX IF NOT EXISTS ix_users_is_suspended ON app.users (is_suspended);
