import { isDemoMode, arePaidApisEnabled } from "@/lib/providers/config";
import { MockAmazonProvider } from "@/lib/providers/amazon/mock";
import { SerpApiAmazonProvider } from "@/lib/providers/amazon/serpapi";
import { PlaywrightAmazonProvider } from "@/lib/providers/amazon/playwright";
import { MockLeadProvider } from "@/lib/providers/lead/mock";
import { ApolloLeadProvider } from "@/lib/providers/lead/apollo";
import { HunterDomainLeadProvider } from "@/lib/providers/lead/hunter-domain";
import { PlaywrightLeadProvider } from "@/lib/providers/lead/playwright";
import { MockEmailProvider } from "@/lib/providers/email/mock";
import { HunterEmailProvider } from "@/lib/providers/email/hunter";
import { MockAiProvider } from "@/lib/providers/ai/mock";
import { RealAiProvider } from "@/lib/providers/ai/real";
import { GoogleSheetsProvider } from "@/lib/providers/sheets/google";
import type { AiProvider, AmazonProvider, EmailProvider, LeadProvider, SheetsProvider } from "@/lib/providers/types";

/** Returns the ordered provider chain for each capability: real provider(s)
 * first (when configured and not demo-mode), mock always last as the
 * guaranteed fallback. The orchestrator walks this chain and stops at the
 * first provider that returns SUCCESS. */
/** `AMAZON_PROVIDER` selects which real Amazon data source to use:
 *   - "playwright": PlaywrightAmazonProvider — real browser-based
 *     discovery, no API key required (see lib/providers/amazon/playwright.ts).
 *   - "mock": force mock data even if SERPAPI_API_KEY is set (useful for
 *     demos/tests without touching a real site at all).
 *   - unset/anything else: existing behavior — SerpApiAmazonProvider
 *     whenever SERPAPI_API_KEY is configured.
 * Mock is always the last-resort fallback in the chain regardless of mode.
 * A future real API provider (e.g. Keepa) would add one more branch here
 * and nowhere else — WF_02 and every downstream workflow/UI consumes the
 * same normalized DiscoveredProduct[] shape no matter which branch ran. */
function amazonProviderMode(): "playwright" | "mock" | "default" {
  const mode = (process.env.AMAZON_PROVIDER || "").trim().toLowerCase();
  if (mode === "playwright") return "playwright";
  if (mode === "mock") return "mock";
  return "default";
}

export function amazonProviderChain(): AmazonProvider[] {
  const chain: AmazonProvider[] = [];
  const mode = amazonProviderMode();

  if (mode === "playwright") {
    chain.push(new PlaywrightAmazonProvider());
  } else if (mode === "default" && process.env.SERPAPI_API_KEY) {
    // SerpApi is a free-tier provider (not a paid API), so — unlike
    // Apollo/Hunter/AI, which need PAID_APIS_ENABLED — it's tried
    // whenever a key is configured, independent of DEMO_MODE: real
    // Amazon data should be used whenever it's genuinely available.
    chain.push(new SerpApiAmazonProvider());
  }
  // mode === "mock" intentionally adds no real provider above.

  chain.push(new MockAmazonProvider());
  return chain;
}

/** True only when a real (non-mock) Amazon data source is configured. Used
 * to decide whether discovered products may be persisted as real Amazon
 * data, or whether the UI must show "Amazon data unavailable —
 * authorization required" instead of fabricated products. */
export function hasRealAmazonProvider(): boolean {
  const mode = amazonProviderMode();
  if (mode === "playwright") return true;
  if (mode === "mock") return false;
  return Boolean(process.env.SERPAPI_API_KEY);
}

/** `LEAD_PROVIDER` selects the real company/decision-maker data source:
 *   - "playwright": PlaywrightLeadProvider — real browser-based research
 *     against the company's own public website, no API key required (see
 *     lib/providers/lead/playwright.ts). Covers both findCompany and
 *     findDecisionMakers since this codebase uses a single LeadProvider
 *     interface for both — a second env var would just always be set to
 *     the same value, so one is enough (avoids inventing configuration).
 *   - "mock": force mock data even if HUNTER_API_KEY/APOLLO_API_KEY are set.
 *   - unset/anything else: existing behavior — Hunter (free) and/or Apollo
 *     (paid-gated) whenever configured.
 * Mock is always the last-resort fallback in the chain regardless of mode. */
function leadProviderMode(): "playwright" | "mock" | "default" {
  const mode = (process.env.LEAD_PROVIDER || "").trim().toLowerCase();
  if (mode === "playwright") return "playwright";
  if (mode === "mock") return "mock";
  return "default";
}

export function leadProviderChain(): LeadProvider[] {
  const chain: LeadProvider[] = [];
  const mode = leadProviderMode();

  if (mode === "playwright") {
    chain.push(new PlaywrightLeadProvider());
  } else if (mode === "default") {
    // Hunter's free-tier Domain Search is real, non-fabricated data — tried
    // whenever a key is configured, independent of DEMO_MODE (same
    // reasoning as SerpApi above). Apollo is a paid API and stays behind
    // PAID_APIS_ENABLED.
    if (process.env.HUNTER_API_KEY) chain.push(new HunterDomainLeadProvider());
    if (process.env.APOLLO_API_KEY && arePaidApisEnabled()) chain.push(new ApolloLeadProvider());
  }
  // mode === "mock" intentionally adds no real provider above.

  chain.push(new MockLeadProvider());
  return chain;
}

/** True when a real (non-mock) source for company/decision-maker data is
 * configured — Playwright, Hunter's free Domain Search, or (paid-gated)
 * Apollo. The orchestrator refuses to persist mock company/decision-maker
 * data as if it were real unless this is true. */
export function hasRealLeadProvider(): boolean {
  const mode = leadProviderMode();
  if (mode === "playwright") return true;
  if (mode === "mock") return false;
  return Boolean(process.env.HUNTER_API_KEY) || Boolean(process.env.APOLLO_API_KEY && arePaidApisEnabled());
}

export function emailProviderChain(): EmailProvider[] {
  const chain: EmailProvider[] = [];
  if (process.env.HUNTER_API_KEY) chain.push(new HunterEmailProvider());
  chain.push(new MockEmailProvider());
  return chain;
}

/** True when a real (non-mock) email discovery/verification source is
 * configured. */
export function hasRealEmailProvider(): boolean {
  return Boolean(process.env.HUNTER_API_KEY);
}

export function aiProviderChain(): AiProvider[] {
  const chain: AiProvider[] = [];
  if (!isDemoMode()) chain.push(new RealAiProvider());
  chain.push(new MockAiProvider());
  return chain;
}

/** Unlike the other capabilities, Sheets export is gated on real Google
 * credentials being present — not on DEMO_MODE. Faking a successful
 * export to a Google Sheets URL that doesn't exist would just be
 * misleading (unlike mock product/company data, which is genuinely useful
 * for demoing the app). GoogleSheetsProvider already reports the honest
 * GOOGLE_SHEETS_NOT_CONFIGURED result on its own when credentials are
 * missing, exactly as documented — see lib/providers/sheets/google.ts. */
export function sheetsProvider(): SheetsProvider {
  return new GoogleSheetsProvider();
}

export function allProviderStatuses() {
  return {
    amazon: amazonProviderChain().map((p) => ({ name: p.name, status: p.status() })),
    lead: leadProviderChain().map((p) => ({ name: p.name, status: p.status() })),
    email: emailProviderChain().map((p) => ({ name: p.name, status: p.status() })),
    ai: aiProviderChain().map((p) => ({ name: p.name, status: p.status() })),
    sheets: [{ name: sheetsProvider().name, status: sheetsProvider().status() }],
  };
}
