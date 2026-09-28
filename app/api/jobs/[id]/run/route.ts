import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runResearchJob, demoModeActive } from "@/lib/orchestrator";

/** Manual retry: re-runs the pipeline for an existing job. Safe to call
 * repeatedly — every write in the orchestrator upserts on a stable key, so
 * retries never create duplicate rows. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: job, error } = await supabase.from("research_jobs").select("*, brands(id, name, marketplace, client_id)").eq("id", params.id).single();
  if (error || !job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const brand = job.brands as unknown as { id: string; name: string; marketplace: string; client_id: string };

  await supabase.from("research_jobs").update({ status: "PENDING", progress: 0, error_message: null, completed_at: null }).eq("id", job.id);

  // Not awaited — see app/api/jobs/route.ts for why. The client polls for progress.
  runResearchJob({
    supabase,
    jobId: job.id,
    brandId: brand.id,
    clientId: brand.client_id,
    brandName: brand.name,
    marketplace: brand.marketplace,
  }).catch((err) => {
    console.error(`runResearchJob retry failed for job ${job.id}:`, err);
  });

  return NextResponse.json({ jobId: job.id, demoMode: demoModeActive() });
}
