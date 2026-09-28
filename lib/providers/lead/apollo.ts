import { arePaidApisEnabled } from "@/lib/providers/config";
import type {
  DiscoveredCompany,
  DiscoveredDecisionMaker,
  LeadProvider,
  ProviderResult,
} from "@/lib/providers/types";
import type { ProviderStatus } from "@/types/database";

const APOLLO_BASE = "https://api.apollo.io/v1";

/** Apollo enrichment consumes paid credits on most plans, so this adapter
 * refuses to run unless PAID_APIS_ENABLED=true. This is intentionally the
 * only provider gated that way — see docs/PROVIDERS.md. */
export class ApolloLeadProvider implements LeadProvider {
  readonly name = "apollo";

  private get apiKey(): string | undefined {
    return process.env.APOLLO_API_KEY;
  }

  private get enabled(): boolean {
    return Boolean(this.apiKey) && arePaidApisEnabled();
  }

  status(): ProviderStatus {
    if (!this.apiKey) return "NOT_CONFIGURED";
    if (!arePaidApisEnabled()) return "DISABLED";
    return "CONFIGURED";
  }

  async findCompany(brand: string, website: string | null): Promise<ProviderResult<DiscoveredCompany | null>> {
    const start = Date.now();
    if (!this.enabled) {
      return { status: "SKIPPED_DISABLED", data: null, durationMs: Date.now() - start, errorMessage: "PAID_APIS_ENABLED=false" };
    }

    try {
      const res = await fetch(`${APOLLO_BASE}/organizations/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": this.apiKey as string },
        body: JSON.stringify({ domain: website ? new URL(website).hostname : undefined, name: brand }),
      });
      if (!res.ok) {
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: `Apollo HTTP ${res.status}` };
      }
      const json = (await res.json()) as { organization?: Record<string, unknown> };
      const org = json.organization;
      if (!org) return { status: "SUCCESS", data: null, durationMs: Date.now() - start };

      const company: DiscoveredCompany = {
        name: String(org.name ?? brand),
        domain: typeof org.primary_domain === "string" ? org.primary_domain : null,
        website: typeof org.website_url === "string" ? org.website_url : website,
        description: typeof org.short_description === "string" ? org.short_description : null,
        employeeRange: typeof org.estimated_num_employees === "number" ? String(org.estimated_num_employees) : null,
        location: [org.city, org.state].filter(Boolean).join(", ") || null,
      };
      return { status: "SUCCESS", data: company, durationMs: Date.now() - start, requestIdentifier: `apollo:${company.domain ?? brand}` };
    } catch (err) {
      return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: err instanceof Error ? err.message : "unknown error" };
    }
  }

  async findDecisionMakers(company: DiscoveredCompany): Promise<ProviderResult<DiscoveredDecisionMaker[]>> {
    const start = Date.now();
    if (!this.enabled) {
      return { status: "SKIPPED_DISABLED", data: null, durationMs: Date.now() - start, errorMessage: "PAID_APIS_ENABLED=false" };
    }

    try {
      const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": this.apiKey as string },
        body: JSON.stringify({
          q_organization_domains: company.domain,
          person_titles: ["Founder", "CEO", "Owner", "President", "Director", "Head of E-commerce", "Marketing Manager"],
          page: 1,
          per_page: 5,
        }),
      });
      if (!res.ok) {
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: `Apollo HTTP ${res.status}` };
      }
      const json = (await res.json()) as { people?: Array<Record<string, unknown>> };
      const people: DiscoveredDecisionMaker[] = (json.people ?? []).map((p) => {
        const linkedin = typeof p.linkedin_url === "string" ? p.linkedin_url : null;
        return {
          name: String(p.name ?? ""),
          jobTitle: String(p.title ?? ""),
          roleCategory: "UNKNOWN",
          linkedinUrl: linkedin,
          linkedinStatus: linkedin ? "FOUND" : "NOT_FOUND",
          location: [p.city, p.state].filter(Boolean).join(", ") || null,
          confidence: 0.75,
        };
      });
      return { status: "SUCCESS", data: people, durationMs: Date.now() - start, requestIdentifier: `apollo:${company.domain}` };
    } catch (err) {
      return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: err instanceof Error ? err.message : "unknown error" };
    }
  }
}
