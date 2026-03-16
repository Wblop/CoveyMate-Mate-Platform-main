# CLAUDE.md - ConveyMate

AI contract-review SaaS for Australian residential property buyers. Accepts uploaded contract packs, runs async extraction + AI analysis in a Lambda worker, delivers citation-backed `report.json` + `report.pdf`.

## Tech Stack

| Layer | Runtime | Path |
|---|---|---|
| Web | Angular + Node 24 | `apps/web/` |
| API | ASP.NET Core 10 (.NET 10) | `apps/apis/conveymate-api/` |
| Worker | .NET 10 (AWS Lambda) in sibling repo | `../ConveyMate-AI/` |
| Database | PostgreSQL 17 | `local/postgres/` |
| Local AWS | LocalStack 4.3 | `local/localstack/` |
| AI | xAI Grok (LLM) + AWS Textract (extraction) + OpenAI (embeddings) | - |
| PDF | QuestPDF + PdfPig | worker only |

## Repo Structure

```
apps/
  apis/conveymate-api/           # .NET 10 orchestration API
  web/                           # Angular SPA
  workers/                       # Parent-repo docs only; worker code lives in ../ConveyMate-AI
../ConveyMate-AI/                # ConveyMate-AI sibling repo
ai/                              # AI tooling (Serena MCP config)
docs/                            # Architecture docs and ADRs
infra/cloudformation/            # CloudFormation IaC
local/                           # Docker Compose (postgres + localstack + serena)
tools/                           # Scripts and utilities
data/                            # Canonical datasets (state rules, suburbs)
```

## Local Development

```bash
# One-command start (installs deps, starts docker, bootstraps SSM, runs everything)
npm run local:all

# Or step by step:
npm run bootstrap          # Install all npm deps
npm run local:up           # Start postgres + localstack + serena (docker-compose)
npm run local:ssm          # Bootstrap SSM parameters
npm run local:api          # Run .NET API (localhost:5000)
npm run local:worker       # Deploy + run Lambda worker
npm run local:web          # Run Angular dev server (localhost:4200)
```

Docker services (once `npm run local:up`):
- PostgreSQL: `localhost:54329`
- LocalStack: `http://localhost:4566`
- Serena MCP: `http://localhost:3000/sse`

## Build & Test Commands

```bash
# Worker (primary AI pipeline)
cd ../ConveyMate-AI
dotnet build ConveyMate-AI.sln
dotnet test ConveyMate-AI.sln

# API
cd apps/apis/conveymate-api
dotnet build src/ConveyMate.Api/ConveyMate.Api.csproj
dotnet test tests/

# Web
cd apps/web
npm test
npm run build
```

## Key Files (AI Pipeline)

| File | Purpose |
|---|---|
| `../ConveyMate-AI/src/ConveyMate.ReportsWorker/Application/Pipeline/ReportPipelineProcessor.cs` | Main AI pipeline orchestrator. Contains all constants, evidence building, Grok calls, contract fact extraction |
| `../ConveyMate-AI/src/ConveyMate.ReportsWorker/Infrastructure/Persistence/WorkerRepository.cs` | All DB queries incl. `ListChunksAsync`, `ListDocumentChunksAsync`, `FindTopChunksAsync` |
| `../ConveyMate-AI/src/ConveyMate.ReportsWorker/Domain/Reports/PdfReportRenderer.cs` | QuestPDF report renderer. Sections 1-6 layout |
| `../ConveyMate-AI/src/ConveyMate.ReportsWorker/Application/Pipeline/ReportPipelineContracts.cs` | All data contracts: `AnalysisReport`, `AnalysisNarrativeSection`, `ContractFacts`, etc. |

## AI Pipeline Constants (ReportPipelineProcessor.cs ~line 86)

```csharp
EvidenceSnippetMaxChars        = 800
EvidenceMaxCharacters          = 48000
EvidenceMaxEstimatedTokens     = 12000
AnalysisMaxOutputTokens        = 6000
SpecialistMaxOutputTokens      = 3500
NarrativeSectionMaxOutputTokens = 2000
StructuredJsonRetryTokenCap    = 10000
```

## Conventions

- **C# style**: top-level statements in Lambda entry; sealed records for DTOs; `var` everywhere; raw string literals for SQL; file-scoped namespaces
- **Database**: schema `app.*`; migrations via DbUp in API startup; column naming is `snake_case`; chunk table is `app.extracted_chunks` (`job_id`, `doc_id`, `page_number`, `content_text`, `section_heading`, `clause_ref`)
- **No auto-commits**: never commit without explicit user request
- **No force push**: never force-push, never skip hooks
- **Tests**: xUnit for worker; 31 tests in `ConveyMate.ReportsWorker.Tests`; always run tests after pipeline changes

## PDF Report Section Layout

```
1. Executive summary
2. Priority actions
3. Questions to ask your conveyancer
4. Detailed review
   4.1 Disclosure checklist
   4.2 Contract risk register
   4.3 Title and encumbrances
   4.4 Planning and hazard context
   4.5 Costs and settlement implications
   4.6 Unusual clauses and missing information
   4.7 Red flags and special context
5. Detailed analysis (NarrativeSections - conditional, only rendered if content exists)
6. Sources and legal notices
   6.1 Source attribution
   6.2 Important legal notices
```

## MCP Tools

Both servers connect automatically via `.mcp.json`. Start the local stack first: `npm run local:up`.

| Server | Connection | Use for |
|---|---|---|
| **Serena** | SSE `http://localhost:3000/sse` (docker) | Symbol lookup, find-references, cross-file navigation |
| **Postgres** | stdio via `npx` + bash env expansion | Query live DB, inspect schema, verify job/chunk data |
| **Git** | stdio via `uvx mcp-server-git` | Log history, blame, diffs, branch state |
| **AWS** | stdio via `uvx awslabs.aws-api-mcp-server` | Query CloudFormation, S3, SQS, Lambda, CloudWatch logs |

Postgres requires `CONVEYMATE_POSTGRES_USER`, `CONVEYMATE_POSTGRES_PASSWORD`, and `CONVEYMATE_POSTGRES_DB` exported in the shell. AWS uses existing `~/.aws` credentials - region is pre-set to `ap-southeast-2`.

The AI repo remote is `https://github.com/daimenrees/ConveyMate-AI`. Clone it into the sibling `../ConveyMate-AI` folder before running worker commands.
