import { callProviderChain } from "@/lib/providers/chain";
import { leadProviderChain } from "@/lib/providers/registry";
import type { DiscoveredDecisionMaker, LeadershipRecord, ProviderResult } from "@/lib/providers/types";

/** Minimum confidence a record needs to be returned by this endpoint. Below
 * this, a finding is real (never fabricated) but too weak to act on with
 * confidence — dropped here rather than shown as if it were reliable. This
 * is a stricter default than the existing WF_06/orchestrator pipeline
 * (lib/orchestrator.ts), which intentionally keeps every finding —
 * including sub-threshold ones — for full transparency in the dashboard.
 * discoverLeadership() is a separate, additive read path; it does not
 * change that existing behavior. */
const MIN_CONFIDENCE = 0.7;

/** A person is corroborated by more than one distinct public page.
 * Deliberately literal about "two independent signals" rather than
 * stretched to count a single strong source as two — with no Google/
 * LinkedIn search in this build, the only real source class is the
 * company's own site (or a licensed provider's own record), so this stays
 * conservative rather than overclaiming verification. */
function isVerified(person: DiscoveredDecisionMaker): boolean {
  return new Set(person.sources ?? []).size >= 2;
}

function sourceTypeFor(providerName: string): LeadershipRecord["sourceType"] {
  if (providerName === "playwright-lead") return "company_website";
  if (providerName === "hunter-domain-search" || providerName === "apollo") return "licensed_provider";
  return "mock";
}

function toLeadershipRecord(person: DiscoveredDecisionMaker, company: string, providerName: string): LeadershipRecord {
  return {
    fullName: person.name,
    title: person.jobTitle,
    company,
    linkedinUrl: person.linkedinUrl,
    sourceUrl: person.sources?.[0] ?? person.linkedinUrl ?? null,
    sourceType: sourceTypeFor(providerName),
    confidence: person.confidence,
    verified: isVerified(person),
  };
}

/** Composes the existing lead-provider chain (findCompany -> findDecisionMakers,
 * both unchanged) into a single "given a brand/company name, return its
 * senior-leadership records" read. Reuses every existing provider,
 * fallback chain, and never-fabricate rule — this file adds no new
 * scraping/search logic of its own, only mapping + a stricter confidence
 * cutoff for this specific read path. Never scrapes Google or LinkedIn:
 * data comes from whichever lead provider is configured (LEAD_PROVIDER),
 * same as the rest of the app. */
export async function discoverLeadership(brandName: string): Promise<ProviderResult<LeadershipRecord[]>> {
  const start = Date.now();

  const companyResult = await callProviderChain(leadProviderChain(), (p) => p.findCompany(brandName, null));
  if (companyResult.result.status === "ERROR") {
    return {
      status: "ERROR",
      data: null,
      durationMs: Date.now() - start,
      errorMessage: companyResult.result.errorMessage ?? "company lookup failed",
    };
  }
  const company = companyResult.result.data;
  if (!company) {
    return {
      status: "SUCCESS",
      data: [],
      durationMs: Date.now() - start,
      errorMessage: "No company found for this brand — no leadership records to discover.",
      requestIdentifier: `leadership-discovery:${brandName}`,
    };
  }

  const peopleResult = await callProviderChain(leadProviderChain(), (p) => p.findDecisionMakers(company));
  if (peopleResult.result.status === "ERROR") {
    return {
      status: "ERROR",
      data: null,
      durationMs: Date.now() - start,
      errorMessage: peopleResult.result.errorMessage ?? "decision-maker lookup failed",
    };
  }

  const people = peopleResult.result.data ?? [];
  const records = people
    .map((person) => toLeadershipRecord(person, company.name, peopleResult.providerName))
    .filter((r) => r.confidence >= MIN_CONFIDENCE);

  return {
    status: "SUCCESS",
    data: records,
    durationMs: Date.now() - start,
    errorMessage: records.length === 0 ? "No leadership records met the confidence threshold for this company." : undefined,
    requestIdentifier: `leadership-discovery:${company.domain ?? company.name}`,
  };
}
