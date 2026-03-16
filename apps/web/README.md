# Frontend Workspace

This workspace contains two separate Angular applications that ship from the same repository:

- `src/marketing-site`
  - Public marketing, SEO, calculators, guides, legal pages, and quote-response flows.
  - Canonical host: `conveymate.com.au`
- `src/app-site`
  - Auth, dashboard, reports, quotes, conveyancers, docs, admin, and SEO Engine.
  - Canonical host: `app.conveymate.com.au`
- `src/shared-core`
  - Shared models, auth client, API clients, metadata config, routing helpers, and SEO helpers.
- `src/shared-ui`
  - Reusable presentational components and neutral layout primitives.

## Commands

- `npm run start:marketing`
  - Run the marketing site locally on `http://localhost:4200`
- `npm run start:app`
  - Run the authenticated app locally on `http://localhost:4201`
- `npm run build:marketing`
  - Build only the marketing site
- `npm run build:app`
  - Build only the authenticated app
- `npm run build`
  - Build both frontend sites

## Deployment Outputs

- Marketing build output: `dist/marketing-site`
- App build output: `dist/app-site`

CI and infra deploy scripts publish those directories independently to the marketing and app CloudFront distributions.
