# Setup

## 1. Install dependencies

```bash
npm install
```

## 2. Environment

```bash
cp .env.example .env.local
```

The defaults (`DEMO_MODE=true`, `PAID_APIS_ENABLED=false`) work with zero
external credentials — the app runs fully in demo mode.

## 3. Real Amazon + company/decision-maker data (optional, free — no API key)

```bash
npm run playwright:install
```

Then set `AMAZON_PROVIDER=playwright` (real Amazon discovery) and/or
`LEAD_PROVIDER=playwright` (real company + decision-maker research from a
company's own public website — no LinkedIn automation, see
[docs/PROVIDERS.md](PROVIDERS.md#why-there-is-no-linkedin-automation)) in
`.env.local`. Skip this step to keep using mock data for either capability.

## 4. Supabase (only needed once you go beyond `npm run dev` with no backend)

1. Create a free Supabase project at https://supabase.com (free tier, no
   card required for the base plan).
2. Copy the project URL, anon key, and service role key into `.env.local`.
3. Apply the schema:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   (Or paste each file in `supabase/migrations/` into the Supabase SQL
   editor directly, in filename order: `0001_init.sql`,
   `0002_fix_new_user_bootstrap.sql`, `0003_listing_issues_idempotency.sql`,
   `0004_lead_research_enrichment_fields.sql`.)

## 5. Sign-in (email + password)

Authentication is Supabase Auth email/password — there's no magic link or
OTP flow. For local development, provision the built-in developer account
instead of building a public sign-up flow:

```bash
npm run seed:developer
```

This creates (or, on repeat runs, just re-syncs the password of) one
development-only account via the Supabase Admin API — it never runs with
`NODE_ENV=production` and never creates a duplicate. Credentials come from
`DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD` in `.env.local` if set, otherwise
the script's local-dev defaults. See `README.md` for the account email;
never commit a real password for this account to a public file.

## 6. Run the app

```bash
npm run dev
```

Visit `http://localhost:3000/login` and sign in with the developer account
from step 5.

## 7. n8n (optional — only for production/live mode)

```bash
docker compose up -d n8n
```

Open `http://localhost:5678` (user `admin` / password `changeme` — change
this), import the workflows from `n8n/workflows/*.json`, and set
`N8N_BASE_URL=http://localhost:5678` + `N8N_WEBHOOK_SECRET=<a random string>`
in `.env.local`. Leave `DEMO_MODE=true` and the app will keep running the
pipeline in-process regardless — n8n only takes over once `DEMO_MODE=false`.

## 8. Tests & build

```bash
npm test
npm run typecheck
npm run build
```
