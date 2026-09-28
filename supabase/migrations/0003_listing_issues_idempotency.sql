-- Fix: listing_issues had no natural key, so retrying a research job (or
-- re-running the n8n listing-audit pipeline) inserted duplicate issue rows
-- instead of upserting. The issue generator (lib/issues.ts and its n8n
-- port in WF_04) produces at most one issue per category per audit, so
-- (audit_id, category) is a safe, already-true-in-practice unique key.

alter table listing_issues
  add constraint listing_issues_audit_id_category_key unique (audit_id, category);
