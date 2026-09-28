-- Amazon LeadFlow — initial schema
-- Source of truth: Supabase PostgreSQL. RLS is enabled on every table that holds
-- client-owned data; access is scoped through profiles -> clients ownership.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated user, linked to auth.users
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  client_id uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- clients: the account/organization a profile operates under
-- ---------------------------------------------------------------------------
create table clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table profiles
  add constraint profiles_client_id_fkey foreign key (client_id) references clients (id) on delete set null;

create index idx_clients_owner on clients (owner_id);

-- ---------------------------------------------------------------------------
-- brands
-- ---------------------------------------------------------------------------
create table brands (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  marketplace text not null default 'amazon.com',
  website text,
  created_at timestamptz not null default now(),
  unique (client_id, normalized_name, marketplace)
);

create index idx_brands_client on brands (client_id);
create index idx_brands_normalized_name on brands (normalized_name);

-- ---------------------------------------------------------------------------
-- research_jobs
-- ---------------------------------------------------------------------------
create table research_jobs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING','RUNNING','DISCOVERING','ANALYZING','ENRICHING','VERIFYING','COMPLETED','PARTIAL','FAILED')),
  progress smallint not null default 0 check (progress between 0 and 100),
  error_message text,
  demo_mode boolean not null default true,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_jobs_brand on research_jobs (brand_id);
create index idx_jobs_client on research_jobs (client_id);
create index idx_jobs_status on research_jobs (status);

-- ---------------------------------------------------------------------------
-- amazon_products (+ dedupe on brand+asin)
-- ---------------------------------------------------------------------------
create table amazon_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  job_id uuid not null references research_jobs (id) on delete cascade,
  asin text not null,
  title text not null,
  brand_label text,
  seller_name text,
  seller_count integer,
  price numeric(10,2),
  currency text default 'USD',
  rating numeric(2,1),
  review_count integer,
  url text not null,
  bullet_points text[] not null default '{}',
  description text,
  classification text not null default 'UNKNOWN'
    check (classification in ('LIKELY_PRIVATE_LABEL','POSSIBLE_PRIVATE_LABEL','LIKELY_RESELLER','WHOLESALE','UNKNOWN')),
  classification_confidence numeric(3,2) not null default 0,
  classification_evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (brand_id, asin)
);

create index idx_products_brand on amazon_products (brand_id);
create index idx_products_job on amazon_products (job_id);
create index idx_products_asin on amazon_products (asin);

-- ---------------------------------------------------------------------------
-- amazon_images
-- ---------------------------------------------------------------------------
create table amazon_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references amazon_products (id) on delete cascade,
  url text not null,
  position smallint not null default 0,
  is_main boolean not null default false,
  has_infographic boolean,
  has_lifestyle boolean,
  created_at timestamptz not null default now(),
  unique (product_id, url)
);

create index idx_images_product on amazon_images (product_id);

-- ---------------------------------------------------------------------------
-- listing_audits (one per product; deterministic weighted score)
-- ---------------------------------------------------------------------------
create table listing_audits (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references amazon_products (id) on delete cascade,
  overall_score numeric(5,2) not null,
  seo_score numeric(5,2) not null,
  title_score numeric(5,2) not null,
  bullet_score numeric(5,2) not null,
  description_score numeric(5,2) not null,
  image_score numeric(5,2) not null,
  conversion_score numeric(5,2) not null,
  competition_score numeric(5,2) not null,
  ai_summary text,
  created_at timestamptz not null default now()
);

create index idx_audits_product on listing_audits (product_id);

-- ---------------------------------------------------------------------------
-- listing_issues
-- ---------------------------------------------------------------------------
create table listing_issues (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references listing_audits (id) on delete cascade,
  category text not null,
  severity text not null check (severity in ('CRITICAL','HIGH','MEDIUM','LOW')),
  title text not null,
  description text not null,
  evidence text,
  recommendation text not null,
  source text not null,
  confidence numeric(3,2) not null default 0.5,
  created_at timestamptz not null default now()
);

create index idx_issues_audit on listing_issues (audit_id);
create index idx_issues_severity on listing_issues (severity);

-- ---------------------------------------------------------------------------
-- companies (dedupe on brand+domain)
-- ---------------------------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references brands (id) on delete cascade,
  name text not null,
  domain text,
  website text,
  description text,
  employee_range text,
  location text,
  source text not null,
  created_at timestamptz not null default now(),
  unique (brand_id, domain)
);

create index idx_companies_brand on companies (brand_id);

-- ---------------------------------------------------------------------------
-- decision_makers
-- ---------------------------------------------------------------------------
create table decision_makers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name text not null,
  job_title text not null,
  role_category text not null,
  linkedin_url text,
  linkedin_status text not null default 'NOT_FOUND' check (linkedin_status in ('FOUND','NOT_FOUND')),
  location text,
  source text not null,
  confidence numeric(3,2) not null default 0.5,
  created_at timestamptz not null default now(),
  unique (company_id, name, job_title)
);

create index idx_decision_makers_company on decision_makers (company_id);

-- ---------------------------------------------------------------------------
-- contacts (email/phone per decision maker)
-- ---------------------------------------------------------------------------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  decision_maker_id uuid not null unique references decision_makers (id) on delete cascade,
  email text,
  email_status text not null default 'NOT_CHECKED' check (email_status in ('VALID','INVALID','ACCEPT_ALL','UNKNOWN','NOT_CHECKED')),
  email_verified_at timestamptz,
  phone text,
  source text not null,
  created_at timestamptz not null default now()
);

create index idx_contacts_decision_maker on contacts (decision_maker_id);
create index idx_contacts_email on contacts (email);

-- ---------------------------------------------------------------------------
-- research_sources: provenance trail for every fact stored above
-- ---------------------------------------------------------------------------
create table research_sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references research_jobs (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  provider text not null,
  url text,
  summary text,
  created_at timestamptz not null default now()
);

create index idx_sources_job on research_sources (job_id);
create index idx_sources_entity on research_sources (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- provider_requests: structured provider call log (no secrets, ever)
-- ---------------------------------------------------------------------------
create table provider_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references research_jobs (id) on delete cascade,
  provider text not null,
  operation text not null,
  status text not null check (status in ('SUCCESS','ERROR','SKIPPED_QUOTA','SKIPPED_DISABLED')),
  duration_ms integer,
  request_identifier text,
  created_at timestamptz not null default now()
);

create index idx_provider_requests_job on provider_requests (job_id);

-- ---------------------------------------------------------------------------
-- ai_analyses: raw structured AI output, schema-validated before use
-- ---------------------------------------------------------------------------
create table ai_analyses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references research_jobs (id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  provider text not null,
  prompt_kind text not null,
  output jsonb not null,
  valid boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_ai_analyses_job on ai_analyses (job_id);

-- ---------------------------------------------------------------------------
-- workflow_errors
-- ---------------------------------------------------------------------------
create table workflow_errors (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references research_jobs (id) on delete cascade,
  workflow text not null,
  step text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index idx_workflow_errors_job on workflow_errors (job_id);

-- ---------------------------------------------------------------------------
-- exports
-- ---------------------------------------------------------------------------
create table exports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references research_jobs (id) on delete cascade,
  brand_id uuid not null references brands (id) on delete cascade,
  destination text not null default 'GOOGLE_SHEETS',
  status text not null check (status in ('SUCCESS','ERROR','NOT_CONFIGURED')),
  spreadsheet_url text,
  created_at timestamptz not null default now()
);

create index idx_exports_job on exports (job_id);

-- ===========================================================================
-- Row Level Security
-- ===========================================================================

alter table profiles enable row level security;
alter table clients enable row level security;
alter table brands enable row level security;
alter table research_jobs enable row level security;
alter table amazon_products enable row level security;
alter table amazon_images enable row level security;
alter table listing_audits enable row level security;
alter table listing_issues enable row level security;
alter table companies enable row level security;
alter table decision_makers enable row level security;
alter table contacts enable row level security;
alter table research_sources enable row level security;
alter table provider_requests enable row level security;
alter table ai_analyses enable row level security;
alter table workflow_errors enable row level security;
alter table exports enable row level security;

-- profiles: a user may only see/update their own row
create policy profiles_select_own on profiles for select using (id = auth.uid());
create policy profiles_update_own on profiles for update using (id = auth.uid());
create policy profiles_insert_own on profiles for insert with check (id = auth.uid());

-- clients: visible to their owner only (single-owner model; extend to
-- membership table later if multi-seat access is needed)
create policy clients_select_own on clients for select using (owner_id = auth.uid());
create policy clients_insert_own on clients for insert with check (owner_id = auth.uid());
create policy clients_update_own on clients for update using (owner_id = auth.uid());
create policy clients_delete_own on clients for delete using (owner_id = auth.uid());

-- helper predicate reused by every downstream table: does the row's client_id
-- belong to the calling user?
create or replace function is_own_client(check_client_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from clients where id = check_client_id and owner_id = auth.uid()
  );
$$;

create policy brands_all_own on brands for all
  using (is_own_client(client_id)) with check (is_own_client(client_id));

create policy jobs_all_own on research_jobs for all
  using (is_own_client(client_id)) with check (is_own_client(client_id));

create policy products_all_own on amazon_products for all
  using (is_own_client((select client_id from brands where id = brand_id)))
  with check (is_own_client((select client_id from brands where id = brand_id)));

create policy images_all_own on amazon_images for all
  using (is_own_client((select client_id from brands b join amazon_products p on p.brand_id = b.id where p.id = product_id)))
  with check (is_own_client((select client_id from brands b join amazon_products p on p.brand_id = b.id where p.id = product_id)));

create policy audits_all_own on listing_audits for all
  using (is_own_client((select client_id from brands b join amazon_products p on p.brand_id = b.id where p.id = product_id)))
  with check (is_own_client((select client_id from brands b join amazon_products p on p.brand_id = b.id where p.id = product_id)));

create policy issues_all_own on listing_issues for all
  using (is_own_client((select client_id from brands b join amazon_products p on p.brand_id = b.id join listing_audits a on a.product_id = p.id where a.id = audit_id)))
  with check (is_own_client((select client_id from brands b join amazon_products p on p.brand_id = b.id join listing_audits a on a.product_id = p.id where a.id = audit_id)));

create policy companies_all_own on companies for all
  using (is_own_client((select client_id from brands where id = brand_id)))
  with check (is_own_client((select client_id from brands where id = brand_id)));

create policy decision_makers_all_own on decision_makers for all
  using (is_own_client((select client_id from brands b join companies c on c.brand_id = b.id where c.id = company_id)))
  with check (is_own_client((select client_id from brands b join companies c on c.brand_id = b.id where c.id = company_id)));

create policy contacts_all_own on contacts for all
  using (is_own_client((select client_id from brands b join companies c on c.brand_id = b.id join decision_makers d on d.company_id = c.id where d.id = decision_maker_id)))
  with check (is_own_client((select client_id from brands b join companies c on c.brand_id = b.id join decision_makers d on d.company_id = c.id where d.id = decision_maker_id)));

create policy sources_all_own on research_sources for all
  using (is_own_client((select client_id from research_jobs where id = job_id)))
  with check (is_own_client((select client_id from research_jobs where id = job_id)));

create policy provider_requests_all_own on provider_requests for all
  using (job_id is null or is_own_client((select client_id from research_jobs where id = job_id)))
  with check (job_id is null or is_own_client((select client_id from research_jobs where id = job_id)));

create policy ai_analyses_all_own on ai_analyses for all
  using (is_own_client((select client_id from research_jobs where id = job_id)))
  with check (is_own_client((select client_id from research_jobs where id = job_id)));

create policy workflow_errors_all_own on workflow_errors for all
  using (job_id is null or is_own_client((select client_id from research_jobs where id = job_id)))
  with check (job_id is null or is_own_client((select client_id from research_jobs where id = job_id)));

create policy exports_all_own on exports for all
  using (is_own_client((select client_id from brands where id = brand_id)))
  with check (is_own_client((select client_id from brands where id = brand_id)));

-- ===========================================================================
-- Bootstrap trigger: create a profile + default client on signup
-- ===========================================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_client_id uuid;
begin
  insert into clients (owner_id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)) || '''s Workspace')
  returning id into new_client_id;

  insert into profiles (id, email, full_name, client_id)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new_client_id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
