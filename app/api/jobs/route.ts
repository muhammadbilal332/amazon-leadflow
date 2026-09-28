import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createBrandSchema } from "@/lib/validation/schemas";
import { normalizeBrandName } from "@/lib/dedupe";
import { runResearchJob, demoModeActive } from "@/lib/orchestrator";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("research_jobs")
    .select("*, brands(name)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data });
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("client_id").eq("id", user.id).single();
  if (!profile?.client_id) return NextResponse.json({ error: "no client workspace found" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = createBrandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  }

  const { brandName, marketplace } = parsed.data;
  const normalizedName = normalizeBrandName(brandName);

  // Idempotent brand lookup/create (brand_id + normalized_name + marketplace is unique).
  const { data: existingBrand } = await supabase
    .from("brands")
    .select("id")
    .eq("client_id", profile.client_id)
    .eq("normalized_name", normalizedName)
    .eq("marketplace", marketplace)
    .maybeSingle();

  let brandId = existingBrand?.id as string | undefined;
  if (!brandId) {
    const { data: newBrand, error: brandError } = await supabase
      .from("brands")
      .insert({ client_id: profile.client_id, name: brandName, normalized_name: normalizedName, marketplace })
      .select("id")
      .single();
    if (brandError || !newBrand) {
      return NextResponse.json({ error: brandError?.message ?? "failed to create brand" }, { status: 500 });
    }
    brandId = newBrand.id;
  }
  if (!brandId) {
    return NextResponse.json({ error: "failed to resolve brand" }, { status: 500 });
  }

  const { data: job, error: jobError } = await supabase
    .from("research_jobs")
    .insert({ brand_id: brandId, client_id: profile.client_id, status: "PENDING", demo_mode: demoModeActive() })
    .select("id")
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: jobError?.message ?? "failed to create job" }, { status: 500 });
  }

  const n8nBaseUrl = process.env.N8N_BASE_URL;
  if (n8nBaseUrl && !demoModeActive()) {
    // Production path: hand off to n8n's orchestrator webhook and return
    // immediately. n8n reports progress back via /api/n8n/webhook.
    fetch(`${n8nBaseUrl.replace(/\/$/, "")}/webhook/brand-lead-orchestrator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id, brandId, clientId: profile.client_id, brandName, marketplace }),
    }).catch(() => {
      /* n8n unreachable — job stays PENDING; workflow_errors row added on next poll/retry */
    });
  } else {
    // Demo / local path: run the same pipeline in-process so the product is
    // fully usable without a running n8n instance. Not awaited — the job
    // starts at PENDING/DISCOVERING and the client polls GET /api/jobs/:id
    // for live progress, the same way the n8n-triggered path already works.
    // (Requires the Node.js runtime, not edge — the process must stay
    // alive after the response is sent for this to keep running.)
    runResearchJob({ supabase, jobId: job.id, brandId, clientId: profile.client_id, brandName, marketplace }).catch((err) => {
      console.error(`runResearchJob failed for job ${job.id}:`, err);
    });
  }

  return NextResponse.json({ jobId: job.id });
}
