# Security

## Row Level Security

Every table holding client-owned data has RLS enabled
(`supabase/migrations/0001_init.sql`). Access is scoped through a
`clients.owner_id = auth.uid()` check, exposed as the `is_own_client(uuid)`
SQL function and applied via policies on `brands`, `research_jobs`, and
every downstream table joined back to a `client_id`. A user can only ever
see or modify their own workspace's data.

RLS correctness is verified by:
- The migration itself (policy definitions are declarative and reviewable).
- Manual verification against a live Supabase project (RLS requires a real
  Postgres instance with `auth.uid()` — it cannot be meaningfully unit
  tested against an in-memory mock). See `docs/SETUP.md`.
- The `is_own_client` helper is `security definer` + `stable`, scoped to
  `search_path = public`, so it can't be tricked via search-path injection.

## Authentication

`/login` uses Supabase Auth email/password (`signInWithPassword`) only —
no magic link, no OTP, no OAuth callback route. There is no public sign-up
form; accounts are provisioned server-side (Supabase dashboard, or the
`npm run seed:developer` script for local development — see `README.md`).

The seeded development account
(`developer@amazonleadflow.local` by default) is a normal, unprivileged
account: it goes through the same `profiles`/`clients` bootstrap trigger
and is scoped by the exact same RLS policies as every other tenant — it
has no elevated database access. `scripts/seed-developer.mjs` refuses to
run with `NODE_ENV=production`, reads its credentials from `.env.local`
(gitignored) rather than the repo, and its service-role usage is
Node-only — never bundled to the browser. Its default password is never
printed in `.env.example`, `README.md`, or any UI string.

## Secrets

- Service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is only ever imported
  from `lib/supabase/admin.ts`, marked with `import "server-only"` so a
  Client Component accidentally importing it fails the build rather than
  leaking the key to the browser.
- Every provider adapter reads its API key from `process.env` server-side
  only; no key is ever passed to a Client Component or embedded in a
  `NEXT_PUBLIC_*` variable.
- `provider_requests` logs provider/operation/status/duration/identifier —
  never the API key or raw response body.
- `.env.example` ships placeholders only; `.gitignore` excludes
  `.env*.local`.

## Paid-API protection

`lib/providers/config.ts::arePaidApisEnabled()` defaults to `false` for
any value other than the literal string `"true"`. Apollo and the real AI
provider check this before making a request; if it's `false` they return
`SKIPPED_DISABLED` rather than calling out. Free-tier providers (SerpApi,
Hunter) never escalate to a paid plan on quota exhaustion — they mark
themselves `FREE_QUOTA_EXHAUSTED` and the orchestrator falls back to mock
data. See `docs/PROVIDERS.md`.

## n8n webhook

`POST /api/n8n/webhook` requires an exact match on `N8N_WEBHOOK_SECRET`
via the `x-n8n-webhook-secret` header; without that env var set, the
endpoint refuses all requests. It also validates every job-status update
against the state machine in `lib/job-states.ts` before writing it.
`POST /api/providers/amazon/search` and `POST /api/providers/lead/company`
/ `POST /api/providers/lead/decision-makers` (n8n's `WF_02` / `WF_05` /
`WF_06` calling into the app's Amazon and lead provider chains) are
protected by the same shared secret and the same "refuses all requests
without it configured" behavior. `middleware.ts`'s matcher excludes
`api/n8n` **and** `api/providers` from the session-cookie check entirely
(these routes authenticate themselves via the header above) — a caller
with no browser session, like n8n, would otherwise be redirected to
`/login` instead of reaching the route.

## Playwright (Amazon discovery, company + decision-maker research)

Neither `PlaywrightAmazonProvider` nor `PlaywrightLeadProvider` requires
any credential — they only read what a normal, unauthenticated browser
session sees on public pages (Amazon search/product pages for the former;
a company's own official website for the latter). Neither performs login,
CAPTCHA solving, stealth/anti-detection techniques, or proxy rotation;
neither ever attempts to defeat any site protection. `PlaywrightAmazonProvider`
throttles product-detail page visits (a delay between them, a cap on how
many are opened per search). **`PlaywrightLeadProvider` never navigates to
linkedin.com at all** — LinkedIn's Terms of Service prohibit automated
scraping, and its people-search/profile pages are gated behind a login
wall in practice, which would require exactly the auth-bypass or
stealth/evasion techniques this project excludes. It sources company and
decision-maker data entirely from the company's own public website; a
`linkedinUrl` is only ever populated when that company's own site
publishes the link itself, or via Hunter/Apollo (which reach LinkedIn data
through their own licensed provider agreements) — never fabricated, never
scraped from LinkedIn directly. See `docs/PROVIDERS.md` for full details
and limitations.

## Input validation

All user-facing API input is parsed through `zod` schemas
(`lib/validation/schemas.ts`) before touching the database. AI-generated
structured output is validated against its own schema before being
persisted; invalid output is marked `valid: false` in `ai_analyses` rather
than trusted.

## LinkedIn

No LinkedIn scraping, login automation, or profile crawling exists
anywhere in this codebase — including in `PlaywrightLeadProvider`, which
never navigates to linkedin.com (see "Playwright" above for why). LinkedIn
URLs only ever come through as a field on `LeadProvider` results: Apollo,
Hunter (via their own licensed provider agreements), a link the company's
own website already published, or mock — if absent, `linkedin_status` is
stored as `NOT_FOUND`, never fabricated.
