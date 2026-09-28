# n8n Workflows

Located in `n8n/workflows/`, one JSON file per workflow, importable
directly into a self-hosted n8n instance (`docker compose up -d n8n`).

| Workflow | Purpose |
|---|---|
| `WF_01_Brand_Lead_Orchestrator` | Entry point. Validates input, calls WF_02–WF_08 in sequence, reports progress/errors to `POST /api/n8n/webhook`. |
| `WF_02_Amazon_Discovery` | Calls the app's `POST /api/providers/amazon/search`, which runs whichever Amazon provider is configured (Playwright / SerpApi / mock — see `AMAZON_PROVIDER` in `docs/PROVIDERS.md`), with a local mock-catalog fallback if the app itself is unreachable. |
| `WF_03_Private_Label_Verification` | Deterministic private-label classification (mirrors `lib/classification.ts`). |
| `WF_04_Amazon_Listing_Audit` | Deterministic component scoring + optional AI component commentary + issue generation. |
| `WF_05_Company_Research` | Calls the app's `POST /api/providers/lead/company`, which runs whichever lead provider is configured (Playwright / Hunter / Apollo / mock — see `LEAD_PROVIDER` in `docs/PROVIDERS.md`), with a local mock fallback if the app itself is unreachable. |
| `WF_06_Decision_Maker_Research` | Calls the app's `POST /api/providers/lead/decision-makers` with the company WF_05 resolved. Same provider chain as WF_05. LinkedIn URLs only ever come from provider data (never from automated LinkedIn scraping — see `docs/PROVIDERS.md`). |
| `WF_07_Email_Enrichment` | Email discovery + verification via Hunter (free tier) or mock. |
| `WF_08_Save_To_Supabase` | Upserts all research into Supabase on stable natural keys (idempotent). |
| `WF_09_Google_Sheets_Export` | Exports one row per (product, decision maker) to Google Sheets, or reports `GOOGLE_SHEETS_NOT_CONFIGURED`. |

## Why n8n workflows exist alongside `lib/orchestrator.ts`

`lib/orchestrator.ts` is the canonical, unit-tested implementation and is
what actually runs in demo mode (`DEMO_MODE=true`, the default — no n8n
required). The n8n workflows implement the identical rules (same scoring
weights, same classification thresholds, same provider fallback order) as
a portable, visually-inspectable workflow graph for production deployments
where orchestration should live outside the Next.js process — e.g. to
survive a Next.js redeploy mid-job, or to be triggered from somewhere
other than the dashboard.

## Wiring it up

**Note:** many self-hosted n8n images (including the one this was verified
against, n8n 2.40.7) run with `N8N_BLOCK_ENV_ACCESS_IN_NODE` set, which
makes *any* `$env.*` reference throw `access to env vars denied` — not
just return empty. Because of this, the checked-in workflows do **not**
rely on container environment variables at all; secrets live in n8n's own
encrypted Credentials store instead. `WF_02_Amazon_Discovery`,
`WF_05_Company_Research`, and `WF_06_Decision_Maker_Research` sidestep
this entirely — they delegate provider selection to the app itself
(`POST /api/providers/amazon/search`, `POST /api/providers/lead/company`,
`POST /api/providers/lead/decision-makers`, which read `AMAZON_PROVIDER` /
`LEAD_PROVIDER` on the Next.js side, not inside n8n), so provider gating
that would otherwise need `$env` never has to happen inside a node. The
remaining gates (`AI Provider Enabled?` in WF_04, `Hunter Enabled?` in
WF_07) are hardcoded to always take the mock branch, matching
`DEMO_MODE=true` / `PAID_APIS_ENABLED=false`. Wiring in a real provider for
those means editing that IF node's condition (or, cleaner, re-adding an
`$env`-based check once your container allows it) — see the comment on
each gate node.

1. `docker compose up -d n8n` (or your own n8n container), open
   `http://localhost:5678`, sign in.
2. Import each file from `n8n/workflows/` (Workflows → Import from File),
   or use the n8n public API (Settings → n8n API → Create API key) to
   `POST /api/v1/workflows` each file's contents programmatically.
3. Create two credentials (Settings → Credentials → New → **Header Auth**):
   - One named e.g. "Supabase Service Role" with header name
     `Authorization`, value `Bearer <your service role key>`. Supabase's
     PostgREST reads *this* header to assume `service_role` and bypass
     RLS — the `apikey` header alone is **not** sufficient for privileged
     writes, only for gateway routing.
   - One for the callback, header name `x-n8n-webhook-secret`, value
     matching `N8N_WEBHOOK_SECRET` in the Next.js app's `.env.local`.
   Attach the Supabase credential to every `Upsert:`/`Insert:` node in
   `WF_08_Save_To_Supabase` (Authentication → Generic Credential Type →
   Header Auth), and attach the webhook credential to the three
   `Report: *` HTTP nodes in `WF_01`, to `WF_02`'s `App: Amazon Discovery`
   node, and to `WF_05`'s `App: Company Research` / `WF_06`'s
   `App: Decision Maker Research` nodes — `/api/providers/amazon/search`
   and `/api/providers/lead/*` all check the same shared secret as
   `/api/n8n/webhook`. Each `Upsert:`/`Insert:` node in `WF_08` also needs a
   plain `apikey` header parameter (same key value) alongside the
   credential — see that workflow's node parameters.
4. In each `Run: *` (Execute Workflow) node inside `WF_01`, open it and
   pick the matching sub-workflow from the dropdown (From list) so it
   references that workflow's real id in this instance — the id embedded
   in the checked-in JSON belongs to the instance it was exported from.
5. **Activate every sub-workflow first, then `WF_01` last** — this n8n
   version refuses to activate a workflow whose `Execute Workflow` nodes
   point at an unpublished (inactive) sub-workflow.
6. Set `N8N_BASE_URL=http://localhost:5678` and a matching
   `N8N_WEBHOOK_SECRET` in the Next.js app's `.env.local`; set
   `DEMO_MODE=false` to have `POST /api/jobs` hand off to `WF_01`'s
   webhook instead of running the pipeline in-process. The app URL
   hardcoded in `WF_01`'s `Report: *` nodes, `WF_02`'s
   `App: Amazon Discovery` node, and `WF_05`/`WF_06`'s `App: Company
   Research` / `App: Decision Maker Research` nodes is
   `http://host.docker.internal:3000` (Docker Desktop's host-reachable
   address) — adjust it if your n8n isn't in Docker Desktop on the same
   machine as the Next.js dev server.

Verified end-to-end: `POST /webhook/brand-lead-orchestrator` with a real
`{jobId, brandId, clientId, brandName, marketplace}` (referencing existing
`brands`/`research_jobs` rows) runs all 8 sub-workflows, writes products,
a listing audit + issues, a company, decision makers, and contacts to
Supabase, and reports `COMPLETED` back to `/api/n8n/webhook` — retriggering
the same job upserts in place with zero duplicate rows.

## Job states reported back

n8n reports progress via `POST /api/n8n/webhook` with a shared secret
(`x-n8n-webhook-secret` header, checked against `N8N_WEBHOOK_SECRET`).
The endpoint validates every status transition against
`lib/job-states.ts::isValidTransition` before writing it, rejecting
anything that isn't a legal move in the job's state machine
(`PENDING → RUNNING/DISCOVERING → ANALYZING → ENRICHING → VERIFYING →
COMPLETED/PARTIAL/FAILED`, with `PENDING` as the only re-entry point for a
retry).
