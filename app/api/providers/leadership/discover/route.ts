import { NextResponse } from "next/server";
import { z } from "zod";
import { discoverLeadership } from "@/lib/providers/people/leadership-discovery";

/** Given a brand/company name, returns its senior-leadership records —
 * composes the existing lead-provider chain (findCompany + findDecisionMakers,
 * both unchanged, see lib/providers/registry.ts::leadProviderChain) rather
 * than adding a new scraping/search mechanism. See
 * lib/providers/people/leadership-discovery.ts for the exact mapping,
 * confidence cutoff, and verified rule.
 *
 * Stateless read endpoint: this does not persist anything itself. Running a
 * brand through the existing "New Research" job flow (POST /api/jobs) is
 * still what persists company/decision-maker data to Supabase.
 */

const bodySchema = z.object({
  brandName: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const secret = request.headers.get("x-n8n-webhook-secret");
  if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ status: "ERROR", records: [], errorMessage: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "ERROR", records: [], errorMessage: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 },
    );
  }

  const result = await discoverLeadership(parsed.data.brandName);

  return NextResponse.json({
    status: result.status,
    records: result.data ?? [],
    errorMessage: result.errorMessage ?? null,
  });
}
