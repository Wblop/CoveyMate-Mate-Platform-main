ALTER TABLE app.users
    ADD COLUMN IF NOT EXISTS retry_credits INTEGER NOT NULL DEFAULT 0;

UPDATE app.users
SET retry_credits = 0
WHERE retry_credits IS NULL;
