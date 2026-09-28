import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exportJobSchema } from "@/lib/validation/schemas";
import { sheetsProvider } from "@/lib/providers/registry";
import { buildExportRows } from "@/lib/export";

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = exportJobSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const { jobId } = parsed.data;

  const built = await buildExportRows(supabase, jobId);
  if (!built) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const provider = sheetsProvider();
  const result = await provider.exportRows(`${built.brandName} - Amazon LeadFlow Export`, built.rows);

  const status = result.status === "SUCCESS" ? "SUCCESS" : result.status === "SKIPPED_DISABLED" ? "NOT_CONFIGURED" : "ERROR";

  await supabase.from("exports").insert({
    job_id: jobId,
    brand_id: built.brandId,
    destination: "GOOGLE_SHEETS",
    status,
    spreadsheet_url: result.data?.spreadsheetUrl ?? null,
  });

  if (status === "NOT_CONFIGURED") {
    return NextResponse.json({ status: "GOOGLE_SHEETS_NOT_CONFIGURED" });
  }
  if (status === "ERROR") {
    return NextResponse.json({ status: "ERROR", message: result.errorMessage }, { status: 502 });
  }
  return NextResponse.json({ status: "SUCCESS", spreadsheetUrl: result.data?.spreadsheetUrl });
}
