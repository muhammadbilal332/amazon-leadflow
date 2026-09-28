import type {
  DiscoveredCompany,
  DiscoveredDecisionMaker,
  LeadProvider,
  ProviderResult,
} from "@/lib/providers/types";

const TITLE_POOL: Array<{ title: string; role: string }> = [
  { title: "Founder & CEO", role: "FOUNDER" },
  { title: "Co-Founder", role: "FOUNDER" },
  { title: "Head of E-commerce", role: "ECOMMERCE" },
  { title: "Marketing Director", role: "MARKETING" },
  { title: "Brand Manager", role: "MARKETING" },
];

function domainFromBrand(brand: string): string {
  return `${brand.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`;
}

export class MockLeadProvider implements LeadProvider {
  readonly name = "mock-lead";

  status() {
    return "CONFIGURED" as const;
  }

  async findCompany(brand: string): Promise<ProviderResult<DiscoveredCompany | null>> {
    const start = Date.now();
    const domain = domainFromBrand(brand);
    const company: DiscoveredCompany = {
      name: `${brand} Inc.`,
      domain,
      website: `https://www.${domain}`,
      description: `${brand} designs and sells consumer products, with a growing presence on Amazon.`,
      employeeRange: ["1-10", "11-50", "51-200"][brand.length % 3],
      location: ["Austin, TX", "Brooklyn, NY", "Los Angeles, CA", "Chicago, IL"][brand.length % 4],
    };
    return { status: "SUCCESS", data: company, durationMs: Date.now() - start, requestIdentifier: `mock:${domain}` };
  }

  async findDecisionMakers(company: DiscoveredCompany): Promise<ProviderResult<DiscoveredDecisionMaker[]>> {
    const start = Date.now();
    const seed = company.name.length;
    const count = 1 + (seed % 3);
    const people: DiscoveredDecisionMaker[] = Array.from({ length: count }).map((_, i) => {
      const pick = TITLE_POOL[(seed + i) % TITLE_POOL.length];
      const first = ["Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery"][(seed + i) % 6];
      const last = ["Bennett", "Clarke", "Douglas", "Reyes", "Kim", "Patel"][(seed + i * 3) % 6];
      const found = (seed + i) % 3 !== 0;
      return {
        name: `${first} ${last}`,
        jobTitle: pick.title,
        roleCategory: pick.role,
        linkedinUrl: found ? `https://www.linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}` : null,
        linkedinStatus: found ? "FOUND" : "NOT_FOUND",
        location: company.location,
        confidence: found ? 0.8 : 0.55,
      };
    });
    return { status: "SUCCESS", data: people, durationMs: Date.now() - start, requestIdentifier: `mock:${company.name}` };
  }
}
