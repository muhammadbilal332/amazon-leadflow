// Development-only account provisioning.
//
// Creates (or, if already present, re-syncs the password of) a single
// developer/admin account for local testing, using the Supabase Admin API.
// This script runs in Node only — it reads SUPABASE_SERVICE_ROLE_KEY from
// the environment and never ships it, or this file, to the browser.
//
// Usage:
//   npm run seed:developer
//
// Idempotent: running it multiple times updates the same account instead
// of creating duplicates. The account gets no special database privileges
// — it goes through the same profiles/clients bootstrap trigger as any
// other user and is scoped by the same RLS policies as every other tenant.
import { createClient } from "@supabase/supabase-js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run: this script provisions a development-only account and must not run with NODE_ENV=production.");
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEV_ADMIN_EMAIL = process.env.DEV_ADMIN_EMAIL || "developer@amazonleadflow.local";
const DEV_ADMIN_PASSWORD = process.env.DEV_ADMIN_PASSWORD || "Dev@AmazonLeadFlow2026!";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Set them in .env.local (see .env.example), then re-run: npm run seed:developer",
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  const perPage = 200;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < perPage) return null; // last page reached
  }
  return null;
}

async function ensureBootstrap(userId) {
  // The on_auth_user_created trigger (supabase/migrations/0001_init.sql,
  // fixed in 0002_fix_new_user_bootstrap.sql) creates profiles/clients rows
  // automatically on insert into auth.users. This is a defensive check only
  // — it fills the gap if that trigger somehow didn't fire (e.g. the
  // account existed before the trigger was installed), never a substitute
  // for it.
  const { data: profile } = await admin.from("profiles").select("id, client_id").eq("id", userId).maybeSingle();
  if (profile?.client_id) return;

  if (!profile) {
    await admin.from("profiles").insert({ id: userId, email: DEV_ADMIN_EMAIL, full_name: "Developer" });
  }

  const { data: existingClient } = await admin.from("clients").select("id").eq("owner_id", userId).maybeSingle();
  const clientId =
    existingClient?.id ??
    (
      await admin
        .from("clients")
        .insert({ owner_id: userId, name: "Developer Workspace" })
        .select("id")
        .single()
    ).data?.id;

  if (clientId) {
    await admin.from("profiles").update({ client_id: clientId }).eq("id", userId);
  }
}

async function main() {
  console.log(`Seeding development account: ${DEV_ADMIN_EMAIL}`);

  const existing = await findUserByEmail(DEV_ADMIN_EMAIL);

  let userId;
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      password: DEV_ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log("Account already existed — password synced, no duplicate created.");
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: DEV_ADMIN_EMAIL,
      password: DEV_ADMIN_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Developer" },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log("Account created.");
  }

  await ensureBootstrap(userId);

  console.log("Done. Sign in at /login with DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD (see .env.local).");
}

main().catch((err) => {
  console.error("seed:developer failed:", err.message ?? err);
  process.exit(1);
});
