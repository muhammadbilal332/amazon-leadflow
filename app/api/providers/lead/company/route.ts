import { NextResponse } from "next/server";
import { z } from "zod";
import { callProviderChain } from "@/lib/providers/chain";
import { leadProviderChain } from "@/lib/providers/registry";

/** Provider-mechanism endpoint: runs the configured company-research
 * provider chain (Playwright / Hunter / Apollo / mock — see
 * lib/providers/registry.ts::leadProviderChain, selected via
 * LEAD_PROVIDER) and returns the result in the same normalized
 * DiscoveredCompany shape the in-process orchestrator persists.
 *
 * Lets n8n's WF_05_Company_Research workflow (which can't run a real
 * browser or import TypeScript providers itself) delegate to whichever
 * lead provider is actually configured. See app/api/providers/amazon/search
 * for the identical pattern already used by WF_02.
 */

const bodySchema = z.object({
  brandName: z.string().trim().min(1),
  website: z.string().trim().min(1).nullable().optional(),
});

export async function POST(request: Request) {
  const secret = request.headers.get("x-n8n-webhook-secret");
  if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ status: "ERROR", provider: null, company: null, errorMessage: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "ERROR", provider: null, company: null, errorMessage: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 },
    );
  }

  const { brandName, website } = parsed.data;
  const { providerName, result } = await callProviderChain(leadProviderChain(), (p) => p.findCompany(brandName, website ?? null));

  return NextResponse.json({
    status: result.status,
    provider: providerName,
    company: result.data ?? null,
    errorMessage: result.errorMessage ?? null,
  });
}
