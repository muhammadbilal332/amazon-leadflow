-- Additive columns for the richer company/decision-maker research contract
-- (lib/providers/types.ts::DiscoveredCompany / DiscoveredDecisionMaker).
-- All nullable, all additive -- no data loss risk, no existing row affected.
--
-- linkedin_url on companies is intentionally never populated by
-- PlaywrightLeadProvider (no LinkedIn automation -- see docs/PROVIDERS.md);
-- it exists so Hunter/Apollo or a future licensed provider can populate it
-- without another migration.

alter table companies
  add column linkedin_url text,
  add column industry text,
  add column founded_year text,
  add column contact_url text,
  add column public_business_email text,
  add column public_business_phone text;

alter table decision_makers
  add column headline text;
