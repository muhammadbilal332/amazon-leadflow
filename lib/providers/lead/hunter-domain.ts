import { quotaTracker } from "@/lib/providers/config";
import type { DiscoveredCompany, DiscoveredDecisionMaker, LeadProvider, ProviderResult } from "@/lib/providers/types";
import type { ProviderStatus } from "@/types/database";

const HUNTER_BASE = "https://api.hunter.io/v2";

const RELEVANT_TITLE_RE = /founder|owner|president|\bceo\b|chief executive|director|head of|e-?commerce|marketing manager|brand manager/i;

/** Real, free-tier decision-maker discovery via Hunter.io's Domain Search
 * endpoint (same free quota as HunterEmailProvider — 25 requests/month).
 * It returns real people Hunter has found associated with a domain from
 * public sources, including a LinkedIn URL when Hunter has one on file —
 * never fabricated, and NOT_FOUND when it doesn't.
 *
 * There's no free "search company by name" API, so the domain is guessed
 * from the brand name (same heuristic lib/providers/lead/mock.ts uses for
 * demo data) and then queried for real. If nothing is found at that
 * domain, that's reported honestly as no data rather than invented. */
export class HunterDomainLeadProvider implements LeadProvider {
  readonly name = "hunter-domain-search";

  private get apiKey(): string | undefined {
    return process.env.HUNTER_API_KEY;
  }

  status(): ProviderStatus {
    if (!this.apiKey) return "NOT_CONFIGURED";
    if (quotaTracker.isExhausted(this.name)) return "FREE_QUOTA_EXHAUSTED";
    return "FREE_QUOTA_UNKNOWN";
  }

  private guessDomain(brand: string): string {
    return `${brand.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`;
  }

  private async domainSearch(domain: string): Promise<ProviderResult<{ organization: string | null; emails: HunterDomainEmail[] }>> {
    const start = Date.now();
    if (!this.apiKey) {
      return { status: "SKIPPED_DISABLED", data: null, durationMs: Date.now() - start, errorMessage: "HUNTER_API_KEY not set" };
    }
    if (quotaTracker.isExhausted(this.name)) {
      return { status: "SKIPPED_QUOTA", data: null, durationMs: Date.now() - start, errorMessage: "FREE_QUOTA_EXHAUSTED" };
    }

    try {
      const params = new URLSearchParams({ domain, api_key: this.apiKey, limit: "10" });
      const res = await fetch(`${HUNTER_BASE}/domain-search?${params.toString()}`);

      if (res.status === 429) {
        quotaTracker.markExhausted(this.name);
        return { status: "SKIPPED_QUOTA", data: null, durationMs: Date.now() - start, errorMessage: "FREE_QUOTA_EXHAUSTED" };
      }
      if (!res.ok) {
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: `Hunter HTTP ${res.status}` };
      }

      const json = (await res.json()) as { data?: { organization?: string; emails?: HunterDomainEmail[] } };
      return {
        status: "SUCCESS",
        data: { organization: json.data?.organization ?? null, emails: json.data?.emails ?? [] },
        durationMs: Date.now() - start,
        requestIdentifier: `hunter-domain:${domain}`,
      };
    } catch (err) {
      return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: err instanceof Error ? err.message : "unknown error" };
    }
  }

  async findCompany(brand: string, website: string | null): Promise<ProviderResult<DiscoveredCompany | null>> {
    const domain = website ? new URL(website).hostname.replace(/^www\./, "") : this.guessDomain(brand);
    const result = await this.domainSearch(domain);
    if (result.status !== "SUCCESS" || !result.data) {
      return { status: result.status, data: null, durationMs: result.durationMs, errorMessage: result.errorMessage };
    }

    if (result.data.emails.length === 0) {
      // Real lookup, genuinely nothing found at this domain — not an error.
      return { status: "SUCCESS", data: null, durationMs: result.durationMs, requestIdentifier: result.requestIdentifier };
    }

    const company: DiscoveredCompany = {
      name: result.data.organization || brand,
      domain,
      website: `https://${domain}`,
      // Hunter's Domain Search doesn't return a company description or
      // headcount — leave unknown rather than inventing one.
      description: null,
      employeeRange: null,
      location: null,
    };
    return { status: "SUCCESS", data: company, durationMs: result.durationMs, requestIdentifier: result.requestIdentifier };
  }

  async findDecisionMakers(company: DiscoveredCompany): Promise<ProviderResult<DiscoveredDecisionMaker[]>> {
    if (!company.domain) return { status: "SUCCESS", data: [], durationMs: 0 };

    const result = await this.domainSearch(company.domain);
    if (result.status !== "SUCCESS" || !result.data) {
      return { status: result.status, data: null, durationMs: result.durationMs, errorMessage: result.errorMessage };
    }

    const people: DiscoveredDecisionMaker[] = result.data.emails
      .filter((e) => e.first_name && e.position)
      .map((e) => {
        const linkedin = e.linkedin && e.linkedin.trim() ? e.linkedin : null;
        const linkedinStatus: "FOUND" | "NOT_FOUND" = linkedin ? "FOUND" : "NOT_FOUND";
        return {
          name: `${e.first_name} ${e.last_name ?? ""}`.trim(),
          jobTitle: e.position as string,
          roleCategory: RELEVANT_TITLE_RE.test(e.position as string) ? "RELEVANT" : "OTHER",
          linkedinUrl: linkedin,
          linkedinStatus,
          location: null,
          confidence: typeof e.confidence === "number" ? e.confidence / 100 : 0.5,
        };
      })
      .sort((a, b) => Number(b.roleCategory === "RELEVANT") - Number(a.roleCategory === "RELEVANT"))
      .slice(0, 5);

    return { status: "SUCCESS", data: people, durationMs: result.durationMs, requestIdentifier: result.requestIdentifier };
  }
}

interface HunterDomainEmail {
  value?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  confidence?: number;
  linkedin?: string | null;
}
