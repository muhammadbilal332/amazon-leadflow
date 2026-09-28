import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidTransition } from "@/lib/job-states";
import type { JobStatus } from "@/types/database";

const VALID_STATUSES: JobStatus[] = [
  "PENDING",
  "RUNNING",
  "DISCOVERING",
  "ANALYZING",
  "ENRICHING",
  "VERIFYING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
];

/** Callback endpoint n8n's WF_08_Save_To_Supabase workflow (or any workflow
 * reporting progress/errors) posts to. Protected by a shared secret header
 * rather than a user session, since n8n has no browser cookies. Uses the
 * service-role client because there is no authenticated user in this
 * request — the secret check is what stands in for authorization here. */
export async function POST(request: Request) {
  const secret = request.headers.get("x-n8n-webhook-secret");
  if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const supabase = createAdminClient();

  if (body.type === "progress") {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `invalid status: ${body.status}` }, { status: 400 });
    }

    const { data: current } = await supabase.from("research_jobs").select("status").eq("id", body.jobId).single();
    if (current && !isValidTransition(current.status, body.status)) {
      await supabase.from("workflow_errors").insert({
        job_id: body.jobId,
        workflow: body.workflow ?? "n8n",
        step: "status_transition",
        message: `Rejected invalid transition ${current.status} -> ${body.status}`,
      });
      return NextResponse.json({ error: "invalid state transition" }, { status: 409 });
    }

    await supabase
      .from("research_jobs")
      .update({ status: body.status, progress: body.progress })
      .eq("id", body.jobId);
  } else if (body.type === "error") {
    await supabase.from("workflow_errors").insert({
      job_id: body.jobId,
      workflow: body.workflow ?? "unknown",
      step: body.step ?? "unknown",
      message: String(body.message ?? "unspecified error"),
    });
  } else if (body.type === "complete") {
    await supabase
      .from("research_jobs")
      .update({ status: body.partial ? "PARTIAL" : "COMPLETED", progress: 100, completed_at: new Date().toISOString() })
      .eq("id", body.jobId);
  }

  return NextResponse.json({ ok: true });
}
