import { NextResponse } from "next/server";
import { z } from "zod";
import { callProviderChain } from "@/lib/providers/chain";
import { amazonProviderChain } from "@/lib/providers/registry";

/** Provider-mechanism endpoint: runs the configured Amazon discovery
 * provider chain (Playwright / SerpApi / mock — see
 * lib/providers/registry.ts::amazonProviderChain, selected via
 * AMAZON_PROVIDER) and returns the result in the same normalized
 * DiscoveredProduct shape the in-process orchestrator persists.
 *
 * This is what lets n8n's WF_02_Amazon_Discovery workflow (which can't run
 * a real browser or import TypeScript providers itself) delegate to
 * whichever Amazon provider is actually configured, without WF_02 or any
 * downstream workflow needing to know which one ran. Swapping providers
 * (mock → Playwright → a future real API) only ever means changing
 * AMAZON_PROVIDER here — this route's contract never changes.
 *
 * Protected by the same shared secret already used for the reverse
 * direction (n8n -> POST /api/n8n/webhook), since this is a server-to-server
 * call with no browser session to authenticate against.
 */

const bodySchema = z.object({
  brandName: z.string().trim().min(1),
  marketplace: z.string().trim().min(1).default("amazon.com"),
});

export async function POST(request: Request) {
  const secret = request.headers.get("x-n8n-webhook-secret");
  if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ status: "ERROR", provider: null, products: [], errorMessage: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "ERROR", provider: null, products: [], errorMessage: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 },
    );
  }

  const { brandName, marketplace } = parsed.data;

  const { providerName, result } = await callProviderChain(amazonProviderChain(), (p) => p.searchByBrand(brandName, marketplace));

  return NextResponse.json({
    status: result.status,
    provider: providerName,
    products: result.data ?? [],
    errorMessage: result.errorMessage ?? null,
  });
}
