// Supabase Edge Function: optional direct-trigger entry point for the
// research pipeline, callable from Supabase (e.g. a database webhook on
// INSERT into research_jobs) without going through Next.js at all. It
// forwards to n8n exactly like app/api/jobs/route.ts does in production
// mode — kept here so the pipeline can be started from pure Supabase
// infrastructure if Next.js isn't in the loop for a given deployment.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (req: Request) => {
  const secret = req.headers.get("x-webhook-secret");
  if (!Deno.env.get("N8N_WEBHOOK_SECRET") || secret !== Deno.env.get("N8N_WEBHOOK_SECRET")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.jobId || !body?.brandName) {
    return new Response(JSON.stringify({ error: "jobId and brandName are required" }), { status: 400 });
  }

  const n8nBaseUrl = Deno.env.get("N8N_BASE_URL");
  if (!n8nBaseUrl) {
    return new Response(JSON.stringify({ error: "N8N_BASE_URL not configured; nothing to trigger" }), { status: 501 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const triggerRes = await fetch(`${n8nBaseUrl.replace(/\/$/, "")}/webhook/brand-lead-orchestrator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);

  if (!triggerRes || !triggerRes.ok) {
    await supabase.from("workflow_errors").insert({
      job_id: body.jobId,
      workflow: "run-research-job-edge-function",
      step: "trigger_n8n",
      message: "Failed to reach n8n orchestrator webhook",
    });
    return new Response(JSON.stringify({ error: "failed to trigger n8n" }), { status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
