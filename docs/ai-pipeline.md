# AI Pipeline

## Scope

The reports worker repo (`../ConveyMate-AI`) processes paid jobs and produces:

- `reports/{jobId}/report.json`
- `reports/{jobId}/report.pdf`

## Processing stages

1. Claim job and mark progress.
2. Extract text from uploads (PDF text path, Textract fallback when needed).
3. Split into chunks and persist chunk records.
4. Generate embeddings (provider selected by config).
5. Retrieve evidence (job chunks plus optional collections/web enrichment).
6. Run analysis and validation passes.
7. Run mandatory negotiation-intelligence passover.
8. Enforce citation integrity.
9. Render and upload JSON/PDF reports.
10. Mark terminal status.

## Services used

- S3: read raw documents, write extracted/report artefacts.
- PostgreSQL: chunks, embeddings, citations, progress, final status.
- xAI APIs: reasoning and retrieval endpoints.
- Textract: OCR fallback.
## Runtime config dependencies

Worker runtime config is loaded from `/conveymate/<env>/*` SSM parameters, including:

- `s3/reportsbucketname`
- `database/connectionstring` or `postgres/connectionstring`
- `grok/*`
- `embeddings/*`
- `textract/enabled`

## Jurisdiction knowledge strategy

- `COMMON` collection holds only cross-jurisdiction frameworks and style/rubric guidance.
- State or territory legal/check content must live in the matching state collection inside the AI repo (for example `../ConveyMate-AI/knowledge/au-act`).
- Retrieval is always scoped to `["COMMON", "<selected_state_or_territory>"]` using the Step 1 jurisdiction selection as source of truth.
- To enable stronger negotiation/state guidance for a new jurisdiction, add a state playbook in that jurisdiction folder and metadata tags (`jurisdiction`, `document_type`, `authority_level`) without changing prompts or hard-coding legal text in worker logic.

## Job status values used in code

- `AwaitingUpload`
- `AwaitingPayment`
- `Paid`
- `Queued`
- `Extracting`
- `Indexing`
- `Analyzing`
- `Validating`
- `Rendering`
- `Completed`
- `Failed`
