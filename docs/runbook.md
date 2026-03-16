# Runbook

## Stalled queued jobs

Symptoms:

- Jobs remain `Queued`.

Checks:

```bash
aws lambda get-function --function-name "$WORKER_FUNCTION_NAME"
```

Actions:

- Confirm worker Lambda is healthy.
- Inspect worker logs for repeated failures.

## Failed jobs

```sql
select id,status,error_message,updated_at
from app.review_jobs
where status='Failed'
order by updated_at desc
limit 20;
```

Actions:

- Classify failure (extraction, DB, S3, external API, validation).
- Fix the root cause before any manual reprocessing.

## Stripe paid but still queued

Checks:

- Verify Stripe webhook delivery and signature validation.
- Verify `app.stripe_webhook_events` records the event.

Actions:

- Correct webhook secret and replay webhook from Stripe.

## Local worker not processing

```bash
npm run local:worker:deploy
aws --endpoint-url http://localhost:4566 lambda list-functions
```

Actions:

- Redeploy worker to LocalStack.
- Confirm `/conveymate/dev/*` SSM values are present.
- Confirm LocalStack services are healthy (`s3`, `sqs`, `lambda`).

## API fails at startup

Common causes:

- Invalid/missing DB connection string.
- Missing Cognito settings.
- Invalid CORS config.
- Migration failure.

Actions:

- Check `/conveymate/<env>/*` parameters.
- Start API locally and inspect startup logs.
- Roll back recent SSM/config changes.
