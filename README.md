# ConveyMate

[![Web Build](https://github.com/daimenrees/ConveyMate/actions/workflows/ci-web.yml/badge.svg?branch=main)](https://github.com/daimenrees/ConveyMate/actions/workflows/ci-web.yml)
[![API Build](https://github.com/daimenrees/ConveyMate/actions/workflows/ci-api.yml/badge.svg?branch=main)](https://github.com/daimenrees/ConveyMate/actions/workflows/ci-api.yml)

ConveyMate is an asynchronous contract review platform for Australian residential property transactions.

It is structured as a web product plus an API and background AI pipeline:

- The web app manages authentication, job creation, document upload, payment, status, and report download.
- The API enforces job lifecycle rules, payment/processing invariants, and environment configuration.
- The reports worker processes paid jobs and produces citation-backed report outputs (`report.json` and `report.pdf`).

The solution is intentionally asynchronous: users submit and pay first, then processing runs in the background so long-running extraction and analysis does not block the web experience.

## What This Solution Covers

ConveyMate currently includes:

- End-to-end local development for web, API, Postgres, and LocalStack-backed AWS services.
- A production-oriented reports pipeline stack (`S3`, `Lambda`) via CloudFormation.
- A first-pass `www` AWS deployment stack covering `VPC`, `Route53`, `ACM`, `CloudFront`, `S3`, `ALB`, `ECS`, `RDS`, `Cognito`, shared artifacts, and the reports worker.
- Core orchestration and operational docs for architecture, deployment, and runbook workflows.

## How It Works (End to End)

1. A user creates a review job in the web app.
2. The API returns presigned upload URLs and records upload intent.
3. The web app uploads source documents to `S3` and finalises uploads.
4. Payment is confirmed via client flow and Stripe webhook backstop.
5. The API marks the job as paid and queued for processing.
6. The reports worker claims the job, extracts text (PDF path + Textract fallback), chunks content, and generates embeddings.
7. The worker retrieves evidence from job content and configured knowledge collections, runs analysis + validation, enforces citation integrity, and renders report outputs.
8. Final report artefacts are written to `S3` and job state is persisted in `PostgreSQL`.

## Architecture

Full details: [docs/architecture.md](docs/architecture.md)

## Repository Layout

- `apps/web`: Angular SPA.
- `apps/apis/conveymate-api`: .NET API and orchestration layer.
- `../ConveyMate-AI`: sibling private repo for the reports worker, AI tests, and knowledge packs.
- `infra`: CloudFormation templates and environment parameter files.
- `local`: Docker Compose and local stack orchestration scripts.
- `docs`: architecture, local dev, deployment, AI pipeline, and runbook docs.

## Run Locally

Prerequisites:

- Node.js `24.13.1+`
- npm `11.8.0+`
- .NET SDK `10.0.100+`
- Docker
- AWS CLI v2 authenticated to the account that holds `/conveymate/dev/*` SSM parameters

Fastest path:

```bash
git clone https://github.com/daimenrees/ConveyMate-AI.git ../ConveyMate-AI
npm run local:start
```

Manual path:

```bash
git clone https://github.com/daimenrees/ConveyMate-AI.git ../ConveyMate-AI
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

## Documentation

- [docs/README.md](docs/README.md)
- [Architecture](docs/architecture.md)
- [Local development](docs/local-development.md)
- [Deployment](docs/deployment.md)
- [AI pipeline](docs/ai-pipeline.md)
- [Runbook](docs/runbook.md)

The AI codebase now lives in the private `ConveyMate-AI` repo at `https://github.com/daimenrees/ConveyMate-AI` and should be cloned into the sibling `../ConveyMate-AI` folder.
