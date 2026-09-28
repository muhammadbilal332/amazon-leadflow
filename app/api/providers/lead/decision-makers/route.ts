import { NextResponse } from "next/server";
import { z } from "zod";
import { callProviderChain } from "@/lib/providers/chain";
import { leadProviderChain } from "@/lib/providers/registry";

/** Provider-mechanism endpoint: runs the configured decision-maker-research
 * provider chain against an already-discovered company (see
 * app/api/providers/lead/company for how that company was found) and
 * returns the result in the same normalized DiscoveredDecisionMaker[]
 * shape the in-process orchestrator persists. Lets n8n's
 * WF_06_Decision_Maker_Research workflow delegate to whichever lead
 * provider is actually configured (LEAD_PROVIDER).
 */

const companySchema = z.object({
  name: z.string().trim().min(1),
  domain: z.string().trim().min(1).nullable().optional(),
  website: z.string().trim().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  employeeRange: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  linkedinUrl: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  foundedYear: z.string().nullable().optional(),
  contactUrl: z.string().nullable().optional(),
  publicBusinessEmail: z.string().nullable().optional(),
  publicBusinessPhone: z.string().nullable().optional(),
  sources: z.array(z.string()).optional(),
});

const bodySchema = z.object({
  company: companySchema,
});

export async function POST(request: Request) {
  const secret = request.headers.get("x-n8n-webhook-secret");
  if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ status: "ERROR", provider: null, people: [], errorMessage: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "ERROR", provider: null, people: [], errorMessage: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 },
    );
  }

  const company = {
    name: parsed.data.company.name,
    domain: parsed.data.company.domain ?? null,
    website: parsed.data.company.website ?? null,
    description: parsed.data.company.description ?? null,
    employeeRange: parsed.data.company.employeeRange ?? null,
    location: parsed.data.company.location ?? null,
    linkedinUrl: parsed.data.company.linkedinUrl ?? null,
    industry: parsed.data.company.industry ?? null,
    foundedYear: parsed.data.company.foundedYear ?? null,
    contactUrl: parsed.data.company.contactUrl ?? null,
    publicBusinessEmail: parsed.data.company.publicBusinessEmail ?? null,
    publicBusinessPhone: parsed.data.company.publicBusinessPhone ?? null,
    sources: parsed.data.company.sources,
  };

  const { providerName, result } = await callProviderChain(leadProviderChain(), (p) => p.findDecisionMakers(company));

  return NextResponse.json({
    status: result.status,
    provider: providerName,
    people: result.data ?? [],
    errorMessage: result.errorMessage ?? null,
  });
}
