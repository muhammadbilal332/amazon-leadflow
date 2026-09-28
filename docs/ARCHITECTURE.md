# Architecture

```
Next.js (App Router)
   |
   +-- app/(pages)         Server Components read Supabase directly (RLS-scoped)
   +-- app/api/*            Route handlers: create jobs, retry, export, n8n callback,
   |                        provider mechanism (/api/providers/amazon/search,
   |                        /api/providers/lead/company, /api/providers/lead/decision-makers)
   +-- lib/orchestrator.ts  The pipeline itself (also callable directly for demo mode)
   |
   v
Supabase
   +-- PostgreSQL           source of truth (supabase/migrations/*.sql, applied in order)
   +-- Auth                 email + password auth
   +-- RLS                  every table scoped to the caller's client_id
   +-- Edge Functions       optional trigger point independent of Next.js
   |
   v
n8n (self-hosted)
   +-- WF_01 Brand Lead Orchestrator   calls WF_02..WF_08 in sequence, reports progress
   +-- WF_02 Amazon Discovery
   +-- WF_03 Private Label Verification
   +-- WF_04 Amazon Listing Audit
   +-- WF_05 Company Research
   +-- WF_06 Decision Maker Research
   +-- WF_07 Email Enrichment
   +-- WF_08 Save To Supabase
   +-- WF_09 Google Sheets Export
```

## Two ways to run the same pipeline

`lib/orchestrator.ts::runResearchJob` implements the full pipeline in
TypeScript. The n8n workflows in `n8n/workflows/` implement the *same*
logic (same scoring weights, same classification rules, same provider
fallback order) as a portable, inspectable workflow graph.

- **Demo / local mode** (`DEMO_MODE=true`, the default): `POST /api/jobs`
  calls `runResearchJob` directly, in-process. No n8n instance required.
- **Production mode** (`DEMO_MODE=false` and `N8N_BASE_URL` set):
  `POST /api/jobs` hands off to n8n's `WF_01` webhook instead, and n8n
  reports progress back to `POST /api/n8n/webhook` (secret-protected).

This means the product is fully demonstrable without running n8n at all,
while n8n remains the orchestration layer for a real deployment.

## Provider abstraction

Every external integration sits behind an interface in
`lib/providers/types.ts` (`AmazonProvider`, `LeadProvider`, `EmailProvider`,
`AiProvider`, `SheetsProvider`). `lib/providers/registry.ts` builds an
ordered fallback chain per capability — real, free-tier provider(s) first
whenever their key/config is present (Playwright and Hunter no longer
require `DEMO_MODE=false`; only the genuinely paid providers, Apollo and
the real AI provider, stay gated behind `PAID_APIS_ENABLED`), the mock
provider always last as the guaranteed fallback — and
`lib/providers/chain.ts::callProviderChain` walks it, returning the first
`SUCCESS`. `lib/orchestrator.ts` additionally refuses to *persist* mock
Amazon/lead data as if it were real (see `docs/PROVIDERS.md`).

n8n's `WF_02_Amazon_Discovery` reaches the same Amazon provider chain
indirectly, via `POST /api/providers/amazon/search`; `WF_05_Company_Research`
and `WF_06_Decision_Maker_Research` do the same for the lead provider chain
via `POST /api/providers/lead/company` and
`POST /api/providers/lead/decision-makers`. This keeps the provider
abstraction on one side (TypeScript) rather than duplicating
provider-selection logic inside a workflow.

## Deterministic vs. AI-assisted logic

Classification (`lib/classification.ts`), audit scoring
(`lib/scoring.ts`), and issue generation (`lib/issues.ts`) are pure,
rule-based, and unit-tested — the same inputs always produce the same
output. AI (`lib/providers/ai`) is used only for supplementary component
commentary, validated against a zod schema (`lib/validation/schemas.ts`)
before being stored; it never determines the final score, never writes to
the database directly, and never makes authorization/deduplication/billing
decisions.
