# Local Development

## Prerequisites

- Node.js `24.13.1+`
- npm `11.8.0+`
- .NET SDK `10.0.100+`
- Docker with Compose
- AWS CLI v2
- AWS auth with access to `/conveymate/dev/*` in SSM

## Fast start

```bash
npm run local:start
```

`local:start` runs checks and starts bootstrap, Docker services, SSM bootstrap, worker deploy, API, and web app.

## Manual start

```bash
npm run bootstrap
npm run local:up
npm run local:ssm:bootstrap
npm run local:worker:deploy
npm run api:run
npm run dev:web
```

Local URLs:

- Web: `http://localhost:4200`
- API: `http://localhost:5141`
- LocalStack: `http://localhost:4566`

## Required secrets for first SSM bootstrap

Provide these env vars before `npm run local:ssm:bootstrap` (or ensure values already exist in SSM):

- `CONVEYMATE_COGNITO_USER_POOL_ID`
- `CONVEYMATE_COGNITO_APP_CLIENT_ID`
- `CONVEYMATE_STRIPE_SECRET_KEY`
- `CONVEYMATE_STRIPE_PUBLISHABLE_KEY`
- `CONVEYMATE_GROK_API_KEY`

Optional:

- `CONVEYMATE_STRIPE_WEBHOOK_SECRET` (needed only to validate signed Stripe webhook calls to `/api/webhooks/stripe`)
- `CONVEYMATE_PUBLIC_GOOGLE_ANALYTICS_MEASUREMENT_ID` (writes `/conveymate/dev/publicmetadata/googleanalyticsmeasurementid` for runtime GA4 injection)

## Verify the stack

```bash
curl -fsS http://localhost:5141/health
curl -fsS http://localhost:5141/metadataconfiguration | jq
```

```bash
psql "Host=localhost;Port=54329;Database=conveymate;Username=conveymate_app;Password=conveymate_local_dev_password;SSL Mode=Disable" \
  -c "select id,status,payment_status,updated_at from app.review_jobs order by updated_at desc limit 10;"
```

## Common failures

- `local:ssm:bootstrap` fails: missing required secret env vars or missing AWS auth.
- Jobs stay `Queued`: rerun `npm run local:worker:deploy` and inspect the worker Lambda logs.
- Web login/payment config missing: check `/metadataconfiguration` output and SSM values.
