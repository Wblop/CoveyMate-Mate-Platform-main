# Architecture

## Runtime components

- `apps/web`: Angular SPA for auth, job submission, payment, status, and downloads.
- `apps/apis/conveymate-api`: .NET API for orchestration, auth-aware endpoints, payment handling, queued-state transitions, and metadata bootstrap.
- `../ConveyMate-AI`: Lambda worker repo (`ConveyMate-AI`) for extraction, retrieval, AI analysis, validation, and report rendering.
- `PostgreSQL`: job state, documents, extracted chunks, embeddings, citations, and progress events.
- `S3`: raw uploads, extracted artefacts, report JSON, and report PDF.
- `External`: Stripe, xAI APIs, Textract.

## Request lifecycle

1. Web creates a review job through API.
2. API returns presigned upload URLs.
3. Web uploads files to S3 and finalises uploads.
4. Payment is confirmed (client confirm endpoint and Stripe webhook backstop).
5. API marks the job paid and queued for processing.
6. Worker processes the job and writes report outputs while updating DB state.

## Boundaries and invariants

- API controls payment and processing-state transition invariants.
- The queued transition is idempotent (`MarkPaidAndQueuedAsync` transition semantics).
- Stripe webhook ingestion is idempotent via `app.stripe_webhook_events`.
- Worker claims jobs with row locking to prevent duplicate in-flight processing.
- Completed reports require citation integrity checks before terminal success.

## Local vs deployed shape

- Local: PostgreSQL + LocalStack (`S3`, `SQS`, `Lambda`) in Docker.
- Local still uses AWS for Cognito and SSM parameter storage.
- Deployed pipeline template exists for `S3/Lambda`.
- Full API compute/network stack (for example `ECS/ALB/VPC`) is not fully defined in repo templates yet.
