import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildExportRows, rowsToCsv } from "@/lib/export";

/** Always-available export: no external OAuth/credentials required, so —
 * unlike Google Sheets — this never has a "not configured" state. Used as
 * the primary export action; Google Sheets is offered alongside it for
 * when real credentials are set up. */
export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const built = await buildExportRows(supabase, jobId);
  if (!built) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const csv = rowsToCsv(built.rows);
  const filename = `${built.brandName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-leadflow-export.csv`;

  await supabase.from("exports").insert({
    job_id: jobId,
    brand_id: built.brandId,
    destination: "CSV",
    status: "SUCCESS",
    spreadsheet_url: null,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
