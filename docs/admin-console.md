# Admin Console

Operational reference for the ConveyMate admin console - job management, user administration, and access control.

---

## Overview

The admin console is accessible at `https://app.conveymate.com.au/admin` for authenticated users flagged as admins. It provides:

- **Jobs** - view all jobs across the platform, delete jobs, inspect generated artifacts (report PDF, report JSON) and uploaded source documents
- **Audit** - review paginated platform activity across auth, reports, quote workflows, shared-document access, and admin controls
- **Users** - view all accounts with spend, activity metrics, and the ability to manually suspend or unsuspend a user

---

## Admin access model

Admin status is stored as `is_admin BOOLEAN` on `app.users` and is granted via the `app.admin_users` allowlist table.

### How `is_admin` is set

On every sign-in, `UpsertFromClaimsAsync` runs an `INSERT ... ON CONFLICT DO UPDATE` that sets:

```sql
is_admin = users.is_admin OR EXISTS (
    SELECT 1 FROM app.admin_users
    WHERE LOWER(email) = LOWER(EXCLUDED.email)
)
```

This means:
- A user in `app.admin_users` will be granted `is_admin = TRUE` on their next sign-in
- Admin flag is never automatically revoked by this upsert - revocation requires a direct DB update (see below)
- Cognito JWT claims (`admin`, `custom:admin`, `cognito:groups`, `role`) are also accepted and unioned with the DB flag at the API response layer

The `AdminAccessAuthorizationHandler` checks both the DB `is_admin` flag and JWT claims, soF either mechanism grants access.

---

## Adding an admin user

### Option 1 - Before the user has registered (recommended)

Insert the email into the allowlist. The `is_admin` flag will be set automatically on their first sign-in.

```sql
INSERT INTO app.admin_users (email)
VALUES ('newadmin@example.com')
ON CONFLICT (email) DO NOTHING;
```

### Option 2 - For an existing registered user

Insert into the allowlist **and** immediately grant the flag (no need to wait for next login):

```sql
INSERT INTO app.admin_users (email)
VALUES ('newadmin@example.com')
ON CONFLICT (email) DO NOTHING;

UPDATE app.users
SET is_admin = TRUE, updated_at = NOW()
WHERE LOWER(email) = LOWER('newadmin@example.com');
```

### Seeded admins

The following email is seeded in migration `0010_add_admin_and_suspension_controls.sql`:

| Email | Source |
|---|---|
| `daimenrees@hotmail.com` | Migration seed |

---

## Revoking admin access

Removing from the allowlist prevents future grants but does not revoke existing `is_admin` flags. To fully revoke:

```sql
-- Remove from allowlist (prevents re-grant on next login)
DELETE FROM app.admin_users WHERE LOWER(email) = LOWER('user@example.com');

-- Revoke the active flag
UPDATE app.users
SET is_admin = FALSE, updated_at = NOW()
WHERE LOWER(email) = LOWER('user@example.com');
```

---

## Suspending a user

### Via admin console UI

Navigate to `https://app.conveymate.com.au/admin` → Users section → click **Suspend** next to the user. Confirm the prompt. The suspension takes effect immediately - the suspension gate middleware blocks all subsequent authenticated requests from that account with a `403` response.

### Via SQL (emergency)

```sql
UPDATE app.users
SET is_suspended = TRUE, suspended_at = NOW(), updated_at = NOW()
WHERE LOWER(email) = LOWER('user@example.com');
```

To unsuspend:

```sql
UPDATE app.users
SET is_suspended = FALSE, suspended_at = NULL, updated_at = NOW()
WHERE LOWER(email) = LOWER('user@example.com');
```

**Note:** An admin cannot suspend themselves - this is enforced server-side in `SetAdminUserSuspensionCommandHandler`.

---

## API endpoints

All routes require the `admin-access` authorization policy (authenticated + admin flag or admin JWT claim).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/jobs` | List all jobs (paginated, filterable by status/search) |
| `GET` | `/api/admin/jobs/{jobId}` | Full job detail with documents list |
| `DELETE` | `/api/admin/jobs/{jobId}` | Delete job record and queue S3 cleanup |
| `GET` | `/api/admin/jobs/{jobId}/artifacts/{artifact}/download` | Pre-signed URL for `report-pdf` or `report-json` |
| `GET` | `/api/admin/jobs/{jobId}/documents/{documentId}/download` | Pre-signed URL for an uploaded source document |
| `GET` | `/api/admin/audit` | Paginated audit trail with summary metrics and filters for user/function/actor type |
| `GET` | `/api/admin/users` | List all users (paginated, searchable) |
| `POST` | `/api/admin/users/{userId}/suspension` | Set `isSuspended` true or false |

### Audit scope

The audit trail focuses on high-signal workflow events rather than raw HTTP request logging. Current coverage includes:

- Auth activity: sign-in completion, sign-up completion, and password-reset requests
- Review activity: report start, upload finalisation, disclaimer acknowledgement, payment confirmation, and report download requests
- Quote workflow activity: workflow creation/open, conveyancer secure-link open, OTP unlock flow, shared report/document downloads, response submission, and conveyancer unsubscribe actions
- Admin activity: job deletion, quote-workflow delete, user suspension, conveyancer controls, and site-notification controls

---

## Security notes

- Admin endpoints use a dedicated `admin-access` policy separate from the standard `RequireAuthorization()` policy
- The suspension gate middleware runs **before** authorization, blocking suspended users from reaching any endpoint
- Admin status is never granted from the frontend - it is always evaluated server-side against DB + JWT claims
- Self-suspension is blocked at the handler level to prevent accidental lockout
