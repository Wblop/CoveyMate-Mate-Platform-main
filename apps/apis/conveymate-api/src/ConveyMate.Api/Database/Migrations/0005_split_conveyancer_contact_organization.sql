ALTER TABLE app.conveyancers
    ADD COLUMN IF NOT EXISTS contact_name TEXT NULL;

ALTER TABLE app.conveyancers
    ADD COLUMN IF NOT EXISTS organization_name TEXT NULL;

UPDATE app.conveyancers
SET organization_name = name
WHERE organization_name IS NULL OR btrim(organization_name) = '';

CREATE INDEX IF NOT EXISTS ix_conveyancers_jurisdiction_active_organization_name
    ON app.conveyancers (jurisdiction, is_active, organization_name, name);
