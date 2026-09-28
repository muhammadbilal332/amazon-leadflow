import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredCompany, DiscoveredDecisionMaker, LeadProvider, ProviderResult } from "@/lib/providers/types";

// discoverLeadership() composes the existing leadProviderChain() rather than
// scraping anything itself, so these tests fake a LeadProvider directly via
// LEAD_PROVIDER=mock + a mocked MockLeadProvider — no browser, no network.

const ORIGINAL_ENV = { ...process.env };

function company(overrides: Partial<DiscoveredCompany> = {}): DiscoveredCompany {
  return { name: "Acme Inc", domain: "acme.com", website: "https://www.acme.com", description: null, employeeRange: null, location: null, ...overrides };
}

function person(overrides: Partial<DiscoveredDecisionMaker> = {}): DiscoveredDecisionMaker {
  return { name: "Jordan Bennett", jobTitle: "Founder & CEO", roleCategory: "FOUNDER", linkedinUrl: null, linkedinStatus: "NOT_FOUND", location: null, confidence: 0.9, ...overrides };
}

function fakeLeadProvider(overrides: {
  name?: string;
  companyResult?: ProviderResult<DiscoveredCompany | null>;
  peopleResult?: ProviderResult<DiscoveredDecisionMaker[]>;
}): LeadProvider {
  const companyResult: ProviderResult<DiscoveredCompany | null> = overrides.companyResult ?? { status: "SUCCESS", data: company(), durationMs: 1 };
  const peopleResult: ProviderResult<DiscoveredDecisionMaker[]> = overrides.peopleResult ?? { status: "SUCCESS", data: [], durationMs: 1 };
  return {
    name: overrides.name ?? "fake-lead",
    status: () => "CONFIGURED",
    findCompany: vi.fn(async () => companyResult),
    findDecisionMakers: vi.fn(async () => peopleResult),
  };
}

describe("discoverLeadership", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
    vi.doUnmock("@/lib/providers/registry");
  });

  it("maps a company-website (playwright-lead) result to a verified=false, sourceType=company_website record", async () => {
    const provider = fakeLeadProvider({
      name: "playwright-lead",
      peopleResult: { status: "SUCCESS", data: [person({ sources: ["https://www.acme.com/team"] })], durationMs: 1 },
    });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("Acme");

    expect(result.status).toBe("SUCCESS");
    expect(result.data).toHaveLength(1);
    const record = result.data![0];
    expect(record.fullName).toBe("Jordan Bennett");
    expect(record.title).toBe("Founder & CEO");
    expect(record.company).toBe("Acme Inc");
    expect(record.sourceType).toBe("company_website");
    expect(record.sourceUrl).toBe("https://www.acme.com/team");
    expect(record.verified).toBe(false); // only 1 distinct source URL
  });

  it("marks verified=true only when corroborated by 2+ distinct source URLs", async () => {
    const provider = fakeLeadProvider({
      name: "playwright-lead",
      peopleResult: {
        status: "SUCCESS",
        data: [person({ sources: ["https://www.acme.com/team", "https://www.acme.com/about"] })],
        durationMs: 1,
      },
    });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("Acme");

    expect(result.data![0].verified).toBe(true);
  });

  it("maps a licensed-provider (hunter-domain-search) result to sourceType=licensed_provider", async () => {
    const provider = fakeLeadProvider({
      name: "hunter-domain-search",
      peopleResult: { status: "SUCCESS", data: [person({ confidence: 0.8 })], durationMs: 1 },
    });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("Acme");

    expect(result.data![0].sourceType).toBe("licensed_provider");
  });

  it("maps a mock-lead result to sourceType=mock", async () => {
    const provider = fakeLeadProvider({
      name: "mock-lead",
      peopleResult: { status: "SUCCESS", data: [person({ confidence: 0.8 })], durationMs: 1 },
    });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("Acme");

    expect(result.data![0].sourceType).toBe("mock");
  });

  it("drops a record below the 0.70 confidence cutoff (never returns a weak, unreliable match by default)", async () => {
    const provider = fakeLeadProvider({
      peopleResult: {
        status: "SUCCESS",
        data: [person({ name: "Weak Match", confidence: 0.6 }), person({ name: "Strong Match", confidence: 0.85 })],
        durationMs: 1,
      },
    });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("Acme");

    expect(result.data!.map((r) => r.fullName)).toEqual(["Strong Match"]);
  });

  it("returns an empty array with an explanation when no company is found (never fabricates one)", async () => {
    const provider = fakeLeadProvider({ companyResult: { status: "SUCCESS", data: null, durationMs: 1 } });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("NoSuchBrand");

    expect(result.status).toBe("SUCCESS");
    expect(result.data).toEqual([]);
    expect(result.errorMessage).toContain("No company found");
  });

  it("returns an empty array with an explanation when the company has no decision makers", async () => {
    const provider = fakeLeadProvider({ peopleResult: { status: "SUCCESS", data: [], durationMs: 1 } });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("Acme");

    expect(result.status).toBe("SUCCESS");
    expect(result.data).toEqual([]);
  });

  it("propagates a provider ERROR at the company-lookup stage instead of silently returning empty", async () => {
    const provider = fakeLeadProvider({ companyResult: { status: "ERROR", data: null, durationMs: 1, errorMessage: "browser launch failed" } });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("Acme");

    expect(result.status).toBe("ERROR");
    expect(result.errorMessage).toContain("browser launch failed");
  });

  it("propagates a provider ERROR at the decision-maker stage instead of silently returning empty", async () => {
    const provider = fakeLeadProvider({ peopleResult: { status: "ERROR", data: null, durationMs: 1, errorMessage: "navigation timeout" } });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("Acme");

    expect(result.status).toBe("ERROR");
    expect(result.errorMessage).toContain("navigation timeout");
  });

  it("never fabricates a linkedinUrl — passes through null exactly as the underlying provider reported it", async () => {
    const provider = fakeLeadProvider({
      peopleResult: { status: "SUCCESS", data: [person({ linkedinUrl: null, linkedinStatus: "NOT_FOUND" })], durationMs: 1 },
    });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("Acme");

    expect(result.data![0].linkedinUrl).toBeNull();
  });

  it("handles duplicate-looking decision-maker entries the way the underlying provider already deduplicates them (no double-counting here)", async () => {
    // PlaywrightLeadProvider already dedupes by name upstream (see
    // tests/playwright-lead.test.ts); this confirms the mapping layer
    // doesn't re-introduce duplicates of its own.
    const provider = fakeLeadProvider({
      peopleResult: { status: "SUCCESS", data: [person({ name: "Jordan Bennett" })], durationMs: 1 },
    });
    vi.doMock("@/lib/providers/registry", () => ({ leadProviderChain: () => [provider] }));

    const { discoverLeadership } = await import("@/lib/providers/people/leadership-discovery");
    const result = await discoverLeadership("Acme");

    expect(result.data!.filter((r) => r.fullName === "Jordan Bennett")).toHaveLength(1);
  });
});
