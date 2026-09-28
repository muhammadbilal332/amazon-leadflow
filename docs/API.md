# API

All routes live under `app/api/`. Except `/api/n8n/webhook` and the
`/api/providers/*` routes (all server-to-server, secret-protected instead
of session-protected), every route requires an authenticated Supabase
session (cookie-based) and is scoped by RLS to the caller's client.

## `GET /api/jobs`
Lists the caller's most recent 50 research jobs.

## `POST /api/jobs`
Body: `{ brandName: string, marketplace?: string }` (validated by
`createBrandSchema`). Idempotently finds-or-creates the brand, creates a
`research_jobs` row, and either runs the pipeline in-process (demo mode)
or hands off to n8n's webhook (production mode). Returns `{ jobId }`.

## `GET /api/jobs/:id`
Returns one job with its brand joined.

## `POST /api/jobs/:id/run`
Retries a job: resets it to `PENDING` and re-runs the pipeline. Safe to
call repeatedly — every write is an upsert on a stable key.

## `POST /api/export/sheets`
Body: `{ jobId: string }`. Builds export rows for the job's products ×
decision makers and calls the configured `SheetsProvider`. Returns
`{ status: "SUCCESS", spreadsheetUrl }`,
`{ status: "GOOGLE_SHEETS_NOT_CONFIGURED" }`, or `{ status: "ERROR" }` —
never a 500 for the "not configured" case.

## `POST /api/n8n/webhook`
Header: `x-n8n-webhook-secret` must match `N8N_WEBHOOK_SECRET`. Body:
`{ type: "progress" | "error" | "complete", jobId, ... }`. Used by n8n
(production mode) to report status back into Supabase. Validates status
transitions against `lib/job-states.ts` and rejects illegal ones with 409.

## `POST /api/providers/amazon/search`
Header: `x-n8n-webhook-secret` must match `N8N_WEBHOOK_SECRET`. Body:
`{ brandName: string, marketplace?: string }`. Runs
`amazonProviderChain()` (Playwright / SerpApi / mock — see
`AMAZON_PROVIDER` in `docs/PROVIDERS.md`) and returns
`{ status, provider, products: DiscoveredProduct[], errorMessage }`. This
is the "provider mechanism" n8n's `WF_02_Amazon_Discovery` calls — the
same normalized product shape the in-process orchestrator persists,
regardless of which concrete provider actually ran.

## `POST /api/providers/lead/company`
Header: `x-n8n-webhook-secret` must match `N8N_WEBHOOK_SECRET`. Body:
`{ brandName: string, website?: string | null }`. Runs
`leadProviderChain()` (Playwright / Hunter / Apollo / mock — see
`LEAD_PROVIDER` in `docs/PROVIDERS.md`) and returns
`{ status, provider, company: DiscoveredCompany | null, errorMessage }`.
The "provider mechanism" n8n's `WF_05_Company_Research` calls.

## `POST /api/providers/lead/decision-makers`
Header: `x-n8n-webhook-secret` must match `N8N_WEBHOOK_SECRET`. Body:
`{ company: DiscoveredCompany }` (the object `/api/providers/lead/company`
returned). Runs `leadProviderChain()` and returns
`{ status, provider, people: DiscoveredDecisionMaker[], errorMessage }`.
The "provider mechanism" n8n's `WF_06_Decision_Maker_Research` calls.

## `POST /api/providers/leadership/discover`
Header: `x-n8n-webhook-secret` must match `N8N_WEBHOOK_SECRET`. Body:
`{ brandName: string }`. Composes the existing `leadProviderChain()`
(`findCompany` + `findDecisionMakers`, unchanged) into a single
"leadership records for this company" read, dropping anything below 0.70
confidence. Returns `{ status, records: LeadershipRecord[], errorMessage }`.
Stateless — does not persist anything; see `docs/PROVIDERS.md#leadership-discovery-discoverleadership`
for the exact mapping. Not wired into any n8n workflow by default.

## Authentication
`/login` uses Supabase Auth email/password sign-in
(`supabase.auth.signInWithPassword`) directly from the client — there is no
separate callback route. See `docs/SETUP.md` for provisioning the
development account.
