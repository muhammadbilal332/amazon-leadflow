# Amazon LeadFlow

## Overview

Amazon lead and brand intelligence automation platform. Enter an Amazon
brand name and get back discovered listings, a private-label
classification, a deterministic listing audit with prioritized issues,
company research, decision-maker/leadership contacts (with LinkedIn URL
and verified email where available), exportable to Google Sheets. Runs
fully in demo mode with realistic mock data and zero external credentials;
real data sources (Playwright-based browser research, SerpApi, Hunter)
can be enabled with no paid API required.

## Core Capabilities

- Amazon discovery (product listings by brand)
- Private-label verification
- Amazon listing research/auditing (deterministic scoring + issue generation)
- Company research
- Decision-maker/leadership research
- Email enrichment
- Automated lead processing (job queue with retry/idempotent upserts)
- Supabase/PostgreSQL persistence with Row Level Security
- n8n workflow automation (production orchestration path)
- Playwright/browser-based providers (Amazon discovery, company + leadership research)
- Provider abstraction (every external integration is swappable via a registry, mock-first)

## Tech Stack

- **Framework**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Database/Auth**: Supabase (PostgreSQL, Auth, Row Level Security, Edge Functions)
- **Automation**: n8n (self-hosted, optional — Docker Compose)
- **Browser automation**: Playwright (Chromium)
- **Validation**: Zod
- **Testing**: Vitest
- **Optional data providers**: SerpApi, Hunter.io (free tiers), Apollo, Google Sheets, Anthropic AI (paid-gated, off by default)

## Architecture

Next.js Server Components read Supabase directly (RLS-scoped); API routes
under `app/api/` create/retry/export jobs and expose a "provider
mechanism" (`/api/providers/*`) that n8n calls into. `lib/orchestrator.ts`
runs the full research pipeline in-process for demo mode; the same logic
is mirrored as a portable n8n workflow graph (`n8n/workflows/`) for
production orchestration. Every external integration (Amazon data,
company/decision-maker research, email, AI, Sheets) sits behind a provider
interface in `lib/providers/types.ts`, selected via
`lib/providers/registry.ts` — real provider first when configured, mock
always as the guaranteed fallback. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
for the full breakdown.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Demo mode (`DEMO_MODE=true`,
`PAID_APIS_ENABLED=false`) is the default — the dashboard, research
pipeline, listing audits, and lead research all work with no API keys.

Supabase (Auth + Postgres + RLS) is required for sign-in and persistence;
see [docs/SETUP.md](docs/SETUP.md) for the free-tier project setup and the
exact migration order. For local development, provision the built-in
developer account instead of a public sign-up flow:

```bash
npm run seed:developer
```

n8n is optional and only takes over from the in-process orchestrator once
`DEMO_MODE=false`; see [docs/N8N.md](docs/N8N.md).

## Environment Variables

See [.env.example](.env.example) for the full list of variable names and
what each one does. Never commit real values — `.env.local` is
gitignored. Key ones:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `AMAZON_PROVIDER` / `LEAD_PROVIDER` — `playwright` for real, free, no-API-key browser-based data; `mock` to force demo data; unset for the SerpApi/Hunter/Apollo-if-configured fallback
- `N8N_BASE_URL` / `N8N_WEBHOOK_SECRET` — only needed once `DEMO_MODE=false`
- `DEMO_MODE`, `PAID_APIS_ENABLED` — safety switches; defaults are the only safe defaults

## n8n

The project uses the existing n8n workflows checked into
`n8n/workflows/` (`WF_01`–`WF_09`) as the production orchestration layer,
mirroring `lib/orchestrator.ts`'s in-process pipeline. See
[docs/N8N.md](docs/N8N.md) for wiring instructions. These workflows are
not redesigned here.

## Testing

```bash
npm test          # vitest run — full unit suite
npm run typecheck  # tsc --noEmit
npm run lint       # next lint
npm run build      # production build
npm run test:live  # opt-in live tests against real sites (excluded from npm test)
```

## Project Structure

```
app/                  Next.js App Router pages + API routes (app/api/*)
components/            Shared UI components
lib/
  providers/           Provider interfaces, registry, and concrete adapters
    amazon/ lead/ email/ ai/ sheets/ people/
  orchestrator.ts       In-process research pipeline (demo mode)
n8n/workflows/          WF_01–WF_09 workflow definitions (production orchestration)
supabase/migrations/    Numbered, additive SQL migrations
scripts/                 One-off local setup scripts (e.g. seed-developer)
tests/                   Vitest unit tests
tests/live/               Opt-in live tests (real network calls)
docs/                    Architecture, setup, providers, n8n, security, API reference
```

## Safety

No paid service has been purchased, subscribed to, or enabled. Every
provider that could incur cost is gated behind `PAID_APIS_ENABLED=false`
by default and falls back to mock data rather than auto-upgrading on free
quota exhaustion. See [docs/SECURITY.md](docs/SECURITY.md) and
[docs/PROVIDERS.md](docs/PROVIDERS.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/SETUP.md](docs/SETUP.md)
- [docs/PROVIDERS.md](docs/PROVIDERS.md)
- [docs/N8N.md](docs/N8N.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/API.md](docs/API.md)
