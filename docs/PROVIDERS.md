# Providers

Every external integration implements an interface from
`lib/providers/types.ts` and always ships with a mock counterpart. Nothing
else in the app imports a concrete provider directly — only
`lib/providers/registry.ts`.

| Capability | Interface | Free/mock provider | Real provider | Gate |
|---|---|---|---|---|
| Amazon discovery | `AmazonProvider` | `MockAmazonProvider` | `PlaywrightAmazonProvider` (real browser, free) or `SerpApiAmazonProvider` (free tier, 100 searches/mo) | `AMAZON_PROVIDER=playwright`, or `SERPAPI_API_KEY` set |
| Company/decision-maker research | `LeadProvider` | `MockLeadProvider` | `PlaywrightLeadProvider` (real browser, free), `HunterDomainLeadProvider` (Hunter free tier), or `ApolloLeadProvider` (paid) | `LEAD_PROVIDER=playwright`, or `HUNTER_API_KEY` set, or `APOLLO_API_KEY` set **and** `PAID_APIS_ENABLED=true` |
| Email discovery/verification | `EmailProvider` | `MockEmailProvider` | `HunterEmailProvider` (Hunter free tier, 25 finder + 50 verifier/mo) | `HUNTER_API_KEY` set |
| AI analysis | `AiProvider` | `MockAiProvider` | `RealAiProvider` (Anthropic Messages API) | `AI_API_KEY` set **and** `PAID_APIS_ENABLED=true` |
| Sheets export | `SheetsProvider` | — (see note) | `GoogleSheetsProvider` | Google OAuth env vars set |

## Fallback order — and why mock data is never *persisted* for Amazon/lead capabilities

`lib/providers/registry.ts` builds one ordered array per capability: real
provider(s) first (whenever their key is configured — free-tier providers
are no longer gated behind `DEMO_MODE`, since real data should be used
whenever it's genuinely available), the mock provider always last.
`lib/providers/chain.ts::callProviderChain` walks the array and returns
the first `SUCCESS`; every attempt (including skipped/failed ones) is
logged to `provider_requests`.

For Amazon products and company/decision-maker data specifically,
`lib/orchestrator.ts` does **not** rely on the mock fallback silently
succeeding. It checks `hasRealAmazonProvider()` / `hasRealLeadProvider()` /
`hasRealEmailProvider()` (all in `lib/providers/registry.ts`) up front: if
no real source is configured, that section is skipped entirely and the job
is marked `PARTIAL` with an explicit
`"... unavailable — authorization required (no <ENV_VAR> configured)"`
message, shown in the UI — instead of persisting `MockAmazonProvider`'s
fake ASINs/prices or `MockLeadProvider`'s fake names/LinkedIn URLs as if
they were real. The mock providers still exist and are still exercised by
the fallback chain (and by n8n's workflow graph) for demoing the pipeline
mechanics; they're just never written to the database as real research
data. AI analysis and Sheets export are unaffected by this — AI only ever
supplies supplementary commentary (never persisted as a fact), and Sheets
already had its own honest not-configured path.

Apollo and the real AI provider are additionally gated behind
`PAID_APIS_ENABLED=true` because neither has a meaningful free tier.

Sheets export remains the one exception to the mock-fallback pattern
entirely: instead of a `MockSheetsProvider` that fakes a successful
export, `sheetsProvider()` always returns `GoogleSheetsProvider`, which
itself reports `GOOGLE_SHEETS_NOT_CONFIGURED` when credentials are
missing. Faking a link to a Google Sheet that doesn't exist would be
actively misleading, so the dashboard's "Download CSV" button is the
always-works export path, and "Export to Google Sheets" is honest about
needing real credentials. `GoogleSheetsProvider` talks to the Sheets/OAuth
REST APIs directly via `fetch` rather than the `googleapis` SDK, which is
large enough to noticeably slow down dev-server compiles for every route
that transitively imports the provider registry.

## Amazon discovery: Playwright vs SerpApi vs mock

`AMAZON_PROVIDER` selects which Amazon data source `amazonProviderChain()`
uses (`lib/providers/registry.ts`):

| `AMAZON_PROVIDER` | Chain | API key needed |
|---|---|---|
| `playwright` | `PlaywrightAmazonProvider` → `MockAmazonProvider` | none |
| `mock` | `MockAmazonProvider` only | none |
| *(unset)* | `SerpApiAmazonProvider` (if `SERPAPI_API_KEY` set) → `MockAmazonProvider` | `SERPAPI_API_KEY` (optional) |

### How Playwright fits in

`PlaywrightAmazonProvider` (`lib/providers/amazon/playwright.ts`) is the
**collection mechanism**, not business logic — it implements the exact
same `AmazonProvider` interface as every other Amazon provider and returns
the exact same normalized `DiscoveredProduct[]` shape. It:
1. Launches headless Chromium (`playwright.chromium.launch`).
2. Navigates to `https://www.<marketplace>/s?k=<brand>` and reads whatever
   a normal visitor's browser would show on the search results page
   (title, ASIN, price, rating, review count, main image).
3. Opens up to 5 of those product pages (with a 1.5s delay between each,
   so it never hammers the site) to pick up bullet points, description,
   and the brand byline.
4. Returns `SUCCESS` with an empty array when a search genuinely finds
   nothing, and `ERROR` (never a thrown exception) on navigation
   failures, timeouts, or an unexpected page structure — either way,
   `callProviderChain` falls through to `MockAmazonProvider` exactly like
   any other provider failure.

It does **not** do — and never will: CAPTCHA solving, login/auth bypass,
stealth/anti-detection plugins, or proxy rotation. If Amazon serves a
block or verification page, extraction just yields few/no results, which
is reported as-is.

Because it's imported dynamically (`await import("playwright")`) only
inside the methods that use it — never at module top level — routes that
don't touch Amazon discovery don't pay any bundle-size or dev-compile cost
for it (the same lesson that led to removing the `googleapis` SDK
earlier — see below).

**Replacing Playwright later** (e.g. with a real API provider such as
Keepa, if/when one is added): implement `AmazonProvider`, add one branch
to `amazonProviderMode()`/`amazonProviderChain()` in
`lib/providers/registry.ts`, done. WF_02, WF_03–WF_09, the orchestrator,
the frontend, and `/api/providers/amazon/search` (below) all consume the
same `DiscoveredProduct[]` shape and never need to change.

### Installing Chromium

```bash
npm install                 # installs the playwright package (already in package.json)
npm run playwright:install  # downloads the Chromium browser binary (~150MB, one-time, free)
```

### Using it

```env
AMAZON_PROVIDER=playwright
```

No `SERPAPI_API_KEY` or any other credential is required. Switch back at
any time by unsetting `AMAZON_PROVIDER` (falls back to SerpApi-if-key/mock)
or setting `AMAZON_PROVIDER=mock` to force demo data.

### n8n integration (WF_02)

`WF_02_Amazon_Discovery` no longer duplicates provider-specific logic
in-workflow. It POSTs `{ brandName, marketplace }` to this app's
**`POST /api/providers/amazon/search`** endpoint (protected by the same
`N8N_WEBHOOK_SECRET` header used elsewhere) and gets back
`{ status, provider, products }`, where `products` is the identical
`DiscoveredProduct[]` shape. That route internally runs
`amazonProviderChain()` — the exact same chain the in-process orchestrator
uses — so WF_02 automatically picks up whichever `AMAZON_PROVIDER` is
configured without ever being touched again. A local Code node still
generates the same deterministic mock catalog as a last-resort fallback
if the app endpoint itself is unreachable (the app's own chain already
falls back to mock internally, so this is a rare belt-and-suspenders
path, not the primary fallback mechanism).

### Limitations of browser-based collection

- **Fragile to markup changes.** Amazon can change its HTML/CSS at any
  time; selectors here may need updating. A selector miss degrades
  gracefully (that field comes back `null`/empty), it doesn't crash the
  scrape.
- **Slower than an API.** A search + up to 5 detail pages, with polite
  delays, takes several seconds to tens of seconds — noticeably slower
  than SerpApi.
- **No seller count / competing-offer data.** That would require visiting
  the buy-box/offers page, which this provider deliberately doesn't do to
  keep the request footprint small and non-invasive.
- **Best-effort, not guaranteed uptime.** Unlike a paid API with an SLA,
  a real page can occasionally serve a layout this provider doesn't
  recognize; that shows up as fewer fields or zero results, never
  fabricated data.
- **Respect Amazon's terms of service** for your own use case — this
  provider only reads what's already public in a normal browser session
  and takes no steps to defeat any site protection; you're responsible
  for how you use it.

### Running the live smoke test

```bash
npm run test:live
```

This launches a real Chromium against real amazon.com (one search for
"Anker") and is **excluded from the normal `npm test` suite** — see
`vitest.config.ts`'s `exclude` and `vitest.live.config.ts`. It never fails
the run on a live-page issue (network hiccup, layout change, a block
page); it just logs a warning, since the point is a smoke check, not a
guarantee that Amazon's markup never changes.

## Company + decision-maker research: Playwright vs Hunter/Apollo vs mock

`LEAD_PROVIDER` selects which company/decision-maker data source
`leadProviderChain()` uses (`lib/providers/registry.ts`). One env var
covers both `findCompany` and `findDecisionMakers` because this codebase
uses a single `LeadProvider` interface for both — a second variable would
always be set to the same value, so it isn't added.

| `LEAD_PROVIDER` | Chain | API key needed |
|---|---|---|
| `playwright` | `PlaywrightLeadProvider` → `MockLeadProvider` | none |
| `mock` | `MockLeadProvider` only | none |
| *(unset)* | `HunterDomainLeadProvider` (if `HUNTER_API_KEY` set) and/or `ApolloLeadProvider` (if `APOLLO_API_KEY` set **and** `PAID_APIS_ENABLED=true`) → `MockLeadProvider` | `HUNTER_API_KEY` / `APOLLO_API_KEY` (optional) |

### Why there is no LinkedIn automation

An earlier draft of this feature considered having Playwright search
LinkedIn directly for company pages and people. That was deliberately
**not implemented**:

- LinkedIn's User Agreement prohibits automated scraping/crawling, and
  LinkedIn has pursued legal action (cease-and-desists, breach-of-contract
  suits) against services that scrape it for lead-gen — real exposure for
  a product that does this at scale.
- It's also not practically achievable within this project's own
  constraints. LinkedIn's people-search and most profile detail sit behind
  a login wall in practice — an unauthenticated session gets a name/
  headline snippet at best before a checkpoint/CAPTCHA. Getting real
  LinkedIn data would require either authentication (excluded — see
  "Security" below) or evading LinkedIn's bot detection (also excluded).

So `PlaywrightLeadProvider` never navigates to linkedin.com. It *can*
still report a `linkedinUrl` for a decision maker: if the company's own
team/leadership page itself publishes a link to someone's LinkedIn
profile (a normal "connect with our team" icon), that link is read
directly off the company's own domain — no LinkedIn request is ever made.
Absent that, `linkedinUrl` is `null` and `linkedinStatus` is `NOT_FOUND`,
exactly like every other provider in this codebase — never fabricated.
`ApolloLeadProvider` and `HunterDomainLeadProvider` remain the way to get
LinkedIn URLs Playwright can't see, since both reach LinkedIn data through
their own licensed provider agreements rather than scraping it directly.

### How Playwright fits in

`PlaywrightLeadProvider` (`lib/providers/lead/playwright.ts`) implements
the same `LeadProvider` interface as Hunter/Apollo/mock and returns the
same normalized `DiscoveredCompany` / `DiscoveredDecisionMaker[]` shapes,
extended with additive, optional fields (every existing provider simply
doesn't set the ones it doesn't research):

```ts
interface DiscoveredCompany {
  name; domain; website; description; employeeRange; location; // existing
  linkedinUrl?;        // never set by Playwright — see "no LinkedIn automation"
  industry?;            // best-effort, from the site's own JSON-LD Organization markup
  foundedYear?;          // e.g. "founded in 2015" / "established 2013" in page text
  contactUrl?;           // the Contact page actually found, if any
  publicBusinessEmail?;  // a mailto: link the site itself published — never guessed
  publicBusinessPhone?;  // a tel: link the site itself published — never guessed
  sources?: string[];    // every public page a result was actually pulled from
}

interface DiscoveredDecisionMaker {
  name; jobTitle; roleCategory; linkedinUrl; linkedinStatus; location; confidence; // existing
  headline?;      // a short tagline found next to the person's name, if any
  sources?: string[];
  evidence?: string[]; // the literal matched text a person/title was extracted from
}
```

`headquarters`/`companySize` from the original design doc are the
existing `location`/`employeeRange` fields — no duplicate fields were
added for names this codebase already uses. `linkedinCompanyUrl` is
`linkedinUrl` on `DiscoveredCompany`. Persisted in
`supabase/migrations/0004_lead_research_enrichment_fields.sql` (additive
nullable columns on `companies`/`decision_makers` — nothing removed or
renamed).

**`findCompany(brand, website)`**
1. If no `website` hint is given, guesses a domain from the brand name
   (same heuristic `HunterDomainLeadProvider` already uses) and navigates
   to it with a real headless browser.
2. **Verifies** the brand actually appears in the page's title or visible
   text before trusting it — a domain that merely resolves is not treated
   as evidence; the URL itself is never used as the verification signal,
   since a guessed domain always "contains" the brand name by
   construction.
3. Follows an About-page and Contact-page link if the homepage nav has
   one, extracting a description, founded year, industry (JSON-LD only),
   and location from whichever pages actually have that data; a
   Contact-page `mailto:`/`tel:` link becomes `publicBusinessEmail`/
   `publicBusinessPhone` — never a plain-text-regex guess, and never a
   specific person's address (that stays WF_07/`EmailProvider`'s job).
   Every page visited is recorded in `sources`.
4. Never fabricates `employeeRange` (not reliably derivable from a public
   marketing site) — leaves it `null`. `linkedinUrl` is always `null` here
   — see "no LinkedIn automation" above.

**`findDecisionMakers(company)`**
1. Navigates to `company.website`, then a Team/Leadership page if the nav
   links to one, then an About page as a second candidate.
2. Runs two independent extraction strategies against each page's text,
   merged together:
   - **Inline**: "Name, Title" / "Name - Title" style text found in a
     sentence or caption (e.g. a narrative About page: *"I'm Jason Fried,
     one of the co-founders..."* — the filler word "I'm" is stripped from
     the captured name, never left in). An optional trailing `, headline
     clause` is captured as `headline`.
   - **Stacked**: a team-listing layout with name, title, and location each
     on their own line/paragraph with no inline separator at all (a very
     common real-world pattern — e.g. Buffer's actual `/about` page lists
     "Joel Gascoigne" / "CEO & Co-Founder" / "Chicago, USA" as three
     separate blocks). The per-person location here overrides
     `company.location` when present.
   Both strategies only keep a match whose title hits a fixed, documented
   set of business-relevant roles (Founder, Co-Founder, CEO, Owner,
   President, Managing Director, General Manager, Head of E-commerce,
   E-commerce Director, Marketing Director, Head of Marketing, Brand
   Manager) — never invents a person or a title outside that list. All-caps
   heading-shaped lines ("ABOUT US") are rejected as name candidates.
3. Deduplicates by name; when the same person is mentioned more than once,
   keeps the higher-confidence match.
4. Confidence is deterministic, not guessed, from two documented signals —
   never a made-up number:

   | Found on a dedicated Team/Leadership or About page | Found on the homepage only |
   |---|---|
   | Stacked layout: **0.9** | Stacked layout: **0.75** |
   | Inline/prose: **0.85** | Inline/prose: **0.6** |

   Returns `SUCCESS` with `[]` (never fabricated) when nothing matches.

Both methods return `SUCCESS` with `null`/`[]` for a genuine "nothing
found" (no such site, brand didn't verify, no matching role text) and
`ERROR` only for an actual failure (browser launch failure, missing
`playwright` package) — `callProviderChain` falls through to
`MockLeadProvider` either way, same as every other provider. This is the
existing project convention for what a hand-written spec might call
`PARTIAL`/`NO_DATA`/`ERROR`: `SUCCESS` + `null`/`[]` already means
"looked, found nothing real," and no new status enum was introduced.

**Source/evidence model**: this reuses `research_sources`
(`lib/orchestrator.ts`'s `LogBuffer.logResearchSource`) — the project's
existing provenance table — rather than a new field-level schema. Each
URL in `sources[]` becomes its own `research_sources` row, and the
existing (previously always-`null`) `summary` column now carries the
`evidence[]` text, so every fact stays traceable to *which page* and
*which literal text* justified it, without a competing source schema.

**Replacing Playwright later** (e.g. with a real company/people-search
API, if/when one is added): implement `LeadProvider`, add one branch to
`leadProviderMode()`/`leadProviderChain()` in `lib/providers/registry.ts`,
done. WF_05, WF_06, WF_07–WF_09, the orchestrator, the frontend, and
`/api/providers/lead/company` + `/api/providers/lead/decision-makers`
(below) all consume the same normalized shapes and never need to change.

### Using it

```env
LEAD_PROVIDER=playwright
```

No `HUNTER_API_KEY`/`APOLLO_API_KEY` required. Switch back at any time by
unsetting `LEAD_PROVIDER` (falls back to Hunter/Apollo-if-key/mock) or
setting `LEAD_PROVIDER=mock` to force demo data.

### n8n integration (WF_05, WF_06)

`WF_05_Company_Research` and `WF_06_Decision_Maker_Research` no longer
duplicate provider-specific logic in-workflow (the old versions had a
hardcoded-false Apollo IF-gate that always fell through to mock, and read
`$env.APOLLO_API_KEY` directly, which n8n's `N8N_BLOCK_ENV_ACCESS_IN_NODE`
setting blocks anyway). They now POST to this app instead:

- WF_05 POSTs `{ brandName }` to **`POST /api/providers/lead/company`**
  and gets back `{ status, provider, company }`.
- WF_06 POSTs `{ company }` (the object WF_05 produced) to
  **`POST /api/providers/lead/decision-makers`** and gets back
  `{ status, provider, people }`.

Both routes are protected by the same `N8N_WEBHOOK_SECRET` header pattern
as `/api/providers/amazon/search`, and both run `leadProviderChain()`
internally — the exact chain the in-process orchestrator uses — so WF_05/
WF_06 automatically pick up whichever `LEAD_PROVIDER` is configured
without ever being touched again. A local Code node in each workflow still
generates the same deterministic mock data as a last-resort fallback if
the app endpoint itself is unreachable. WF_05/WF_06's Code nodes spread
the whole company/person object through (`{...resp.company, source:
resp.provider}`), so the new enrichment fields flow through automatically;
`WF_08_Save_To_Supabase`'s `Map Company Row`/`Map Decision Maker Rows`
nodes were updated to include them explicitly in the upsert payload, since
those nodes enumerate columns rather than spreading.

### Limitations of website-based collection

- **Fragile to page-structure changes**, same as the Amazon provider — a
  selector/pattern miss degrades to fewer fields or an empty result, never
  a crash or fabricated data.
- **No LinkedIn automation** (see above) — LinkedIn URLs only ever come
  from a company's own published team-page links, or from Hunter/Apollo.
- **Name/title extraction is text-pattern based**, not a structured API —
  it recognizes common "Name, Title" phrasing and the "stacked" name/
  title/location layout, but will miss unusual page layouts (image-only
  team grids with no adjacent text, JavaScript-only rendering of names,
  etc.).
- **`employeeRange` is not collected** — not reliably available on a
  public marketing site without guessing. `industry` is best-effort only
  (JSON-LD Organization markup, which most sites don't publish). Per-person
  email discovery/verification stays WF_07's job (`EmailProvider`), not
  this one's — `publicBusinessEmail`/`publicBusinessPhone` are company-level
  only, and only ever a `mailto:`/`tel:` link the site itself published.
- **Best-effort, not guaranteed uptime** — same caveat as the Amazon
  provider.

### Running the live smoke test

```bash
npm run test:live
```

This also runs `tests/live/playwright-lead.live.test.ts` (real company
research for a well-known brand's own website, no LinkedIn involved) —
**excluded from the normal `npm test` suite**, same as the Amazon live
test. It never fails the run on a live-page issue; it logs a warning
instead, since the point is a smoke check.

## Leadership Discovery: `discoverLeadership()`

`lib/providers/people/leadership-discovery.ts` composes the existing
`leadProviderChain()` (`findCompany` → `findDecisionMakers`, both
completely unchanged) into a single "given a brand/company name, return
its senior-leadership records" read. It is **not** a new provider and adds
no new scraping/search mechanism of its own — no new `*_PROVIDER` env var,
no new registry chain — it only maps the existing `DiscoveredDecisionMaker[]`
into a slightly different shape and applies a stricter default confidence
cutoff for this specific read path:

```ts
interface LeadershipRecord {
  fullName: string;
  title: string;
  company: string;
  linkedinUrl: string | null;
  sourceUrl: string | null;
  sourceType: "company_website" | "licensed_provider" | "mock";
  confidence: number;
  verified: boolean;
}
```

- **`sourceType`** is derived from which concrete provider actually ran:
  `playwright-lead` → `company_website`, `hunter-domain-search`/`apollo` →
  `licensed_provider`, `mock-lead` → `mock`.
- **`verified`** is `true` only when the person is corroborated by **2 or
  more distinct source page URLs** — deliberately literal, not stretched:
  with no Google/LinkedIn search in this build, the only real source class
  is the company's own site (or a licensed provider's own record), so a
  single strong source stays `verified: false` rather than being
  overclaimed as independently confirmed.
- **Confidence cutoff**: records below `0.70` are dropped by default —
  stricter than the existing WF_06/dashboard pipeline
  (`lib/orchestrator.ts`), which intentionally keeps every finding,
  including lower-confidence ones, for full transparency in the UI. This
  function is a separate, additive read path and does not change that
  existing behavior.
- **Never fabricates** a `linkedinUrl`, a person, a title, or a company —
  passes through exactly what the underlying `LeadProvider` reported
  (`null` stays `null`).

### Why this doesn't search Google or scrape LinkedIn

An automated "search Google for this person's LinkedIn profile" step was
considered and **deliberately not implemented**, for two independent
reasons, not just one:

1. **Google's Terms of Service** prohibit automated, non-API scraping of
   Search results. Sending repeated automated queries to google.com/search
   from a headless browser is exactly what that restriction covers,
   regardless of whether the code itself ever tries to solve a CAPTCHA.
2. **It wouldn't reliably work anyway.** Google's own anti-automation
   systems block datacenter/headless traffic within a handful of requests.
   The only way to keep it functioning past that point is CAPTCHA-solving
   or stealth/anti-detection techniques — both explicitly out of scope for
   this project (see "Security" below), for any site.

Google's official, ToS-compliant path — the Custom Search JSON API — was
also considered and set aside: it requires a billed Google Cloud project
even to use its small free quota, which falls under this project's
no-paid-API rule the same way SerpApi/Hunter/Apollo already do.

So `discoverLeadership()` sources leadership data the same way the rest of
the lead-research pipeline already does: the company's own public website
(`PlaywrightLeadProvider`), or a licensed provider's own data
(Hunter/Apollo) when configured. `linkedinUrl` on a `LeadershipRecord`
reflects whatever the underlying `DiscoveredDecisionMaker.linkedinUrl`
already was — a link the company published on its own site, or one
returned by a licensed provider — never a URL discovered via Google, and
never a guessed slug.

### Endpoint

`POST /api/providers/leadership/discover` — same
`x-n8n-webhook-secret` protection as every other `/api/providers/*` route.

Request:
```json
{ "brandName": "Buffer" }
```

Response:
```json
{
  "status": "SUCCESS",
  "records": [
    {
      "fullName": "Joel Gascoigne",
      "title": "CEO & Co-Founder",
      "company": "Buffer: Social media management for everyone",
      "linkedinUrl": null,
      "sourceUrl": "https://buffer.com/about",
      "sourceType": "company_website",
      "confidence": 0.9,
      "verified": false
    }
  ],
  "errorMessage": null
}
```
(Real output from a live run against buffer.com — Joel Gascoigne is
genuinely Buffer's co-founder, not fabricated.)

This is a **stateless read endpoint** — it does not persist anything on
its own. Running a brand through the existing "New Research" job flow
(`POST /api/jobs`) is still what persists company/decision-maker data to
Supabase, exactly as before; `discoverLeadership()` is an additive,
independent read path, not a replacement for WF_05/WF_06.

### Replacing this with a real search/people API later

Nothing here is hard-coded to Playwright. To add a real API-backed source:
implement `LeadProvider`, add one branch to `leadProviderChain()` in
`lib/providers/registry.ts` (the existing pattern — see `LEAD_PROVIDER`
above), and `discoverLeadership()` picks it up automatically since it only
depends on that chain, never a concrete provider. No change needed to this
file, the API route, or any n8n workflow.

## Hunter's free tier covers three capabilities

A single `HUNTER_API_KEY` unlocks real data for Amazon LeadFlow's two
non-Amazon capabilities at once:
- **`HunterDomainLeadProvider`** (`lib/providers/lead/hunter-domain.ts`)
  calls Hunter's free **Domain Search** endpoint to find real people
  associated with a company's domain — name, title, and a LinkedIn URL
  when Hunter has one on file (never invented; absent ⇒ `NOT_FOUND`).
  There's no free "search company by name" API, so the domain is guessed
  from the brand name (same heuristic the mock provider uses); if nothing
  real is found there, that's reported honestly rather than guessed again.
- **`HunterEmailProvider`** (`lib/providers/email/hunter.ts`) then finds
  and verifies a real email per decision maker via Hunter's Email Finder +
  Email Verifier endpoints.

Both share Hunter's free monthly quota (25 finder + 50 verifier
requests), tracked in-process by `lib/providers/config.ts::quotaTracker`.

## Free-quota exhaustion

SerpApi and Hunter adapters track a 429 response in-memory
(`lib/providers/config.ts::quotaTracker`) and report `FREE_QUOTA_EXHAUSTED`
from `status()` for the rest of the process lifetime. The orchestrator
never retries against a paid tier automatically — it just falls through to
the next provider in the chain (ultimately the mock, which — per above —
isn't persisted as real data for Amazon/lead capabilities), and the job
completes as `PARTIAL`, never `FAILED` outright.

## Provider statuses

`GET` `/settings` renders `allProviderStatuses()` live: `CONFIGURED`,
`NOT_CONFIGURED`, `FREE_QUOTA_UNKNOWN`, `FREE_QUOTA_EXHAUSTED`,
`DISABLED`, or `ERROR`.

## Adding a new provider

1. Implement the relevant interface in a new file under
   `lib/providers/<capability>/<name>.ts`.
2. Add it to the appropriate chain in `lib/providers/registry.ts`, gated
   by whatever env var / `PAID_APIS_ENABLED` check is appropriate.
3. No other file needs to change — orchestrator, API routes, and UI all
   depend on the interface, not the concrete class.
