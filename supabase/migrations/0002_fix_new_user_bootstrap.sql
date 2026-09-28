-- Fix: "Database error saving new user" on every signup.
--
-- Root cause: handle_new_user() (0001_init.sql) inserted into `clients`
-- first. clients.owner_id is `not null references profiles (id)`, but no
-- `profiles` row for the new user existed yet at that point (profiles was
-- only inserted afterward) — so the very first insert violated the FK on
-- every signup, and Postgres rolled back the whole trigger transaction,
-- including the auth.users insert itself. No orphaned rows were ever
-- created, so no data backfill is needed here.
--
-- Fix: create the `profiles` row first (profiles.client_id is nullable,
-- so this is valid on its own), which satisfies clients.owner_id's FK to
-- profiles(id); then create the `clients` row; then backfill
-- profiles.client_id. Also add an idempotency guard so a retried/re-fired
-- trigger can never create duplicate profiles or clients for the same user.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_client_id uuid;
begin
  -- Idempotent: if this user already has a profile, do nothing.
  if exists (select 1 from profiles where id = new.id) then
    return new;
  end if;

  insert into profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');

  insert into clients (owner_id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)) || '''s Workspace')
  returning id into new_client_id;

  update profiles set client_id = new_client_id where id = new.id;

  return new;
end;
$$;
