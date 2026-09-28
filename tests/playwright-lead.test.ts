import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoveredCompany } from "@/lib/providers/types";

// Same dynamic-import-mocking approach as tests/playwright-amazon.test.ts:
// PlaywrightLeadProvider only ever does `await import("playwright")` inside
// its methods, so mocking the "playwright" module specifier intercepts it
// too — no real browser or live website involved in this file.

interface FakePageData {
  title: string;
  text: string;
  linkedinLinks?: Array<{ href: string; nearbyText: string }>;
  internalLinks?: Array<{ href: string; text: string }>;
  mailtoEmails?: string[];
  telPhones?: string[];
  jsonLdIndustry?: string | null;
}

describe("PlaywrightLeadProvider", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("playwright");
  });

  it("findCompany: verifies the brand appears on the page and extracts description/location/sources/foundedYear/industry/contact info", async () => {
    const fakePage = makeFakeLeadPage({
      "https://www.acme.com/": {
        title: "Acme Inc | Home",
        text: "Welcome to Acme Inc.",
        internalLinks: [
          { href: "https://www.acme.com/about", text: "About" },
          { href: "https://www.acme.com/contact", text: "Contact" },
        ],
      },
      "https://www.acme.com/about": {
        title: "About | Acme Inc",
        text: "Acme Inc was founded in 2015 and is headquartered in Austin, TX. We build great widgets for everyone to enjoy every single day.",
        jsonLdIndustry: "Consumer Goods",
      },
      "https://www.acme.com/contact": {
        title: "Contact | Acme Inc",
        text: "Reach us in Austin, TX at our office.",
        mailtoEmails: ["hello@acme.com"],
        telPhones: ["+1-512-555-0100"],
      },
    });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const result = await provider.findCompany("Acme", "https://www.acme.com/");

    expect(result.status).toBe("SUCCESS");
    const company = result.data!;
    expect(company.domain).toBe("acme.com");
    expect(company.website).toBe("https://www.acme.com");
    expect(company.description).toContain("founded in 2015");
    expect(company.location).toBe("Austin, TX");
    expect(company.employeeRange).toBeNull();
    expect(company.foundedYear).toBe("2015");
    expect(company.industry).toBe("Consumer Goods");
    expect(company.contactUrl).toBe("https://www.acme.com/contact");
    expect(company.publicBusinessEmail).toBe("hello@acme.com");
    expect(company.publicBusinessPhone).toBe("+1-512-555-0100");
    expect(company.linkedinUrl).toBeNull();
    expect(company.sources).toEqual(["https://www.acme.com/", "https://www.acme.com/about", "https://www.acme.com/contact"]);
  });

  it("findCompany: never fabricates industry/contact info when the site publishes none", async () => {
    const fakePage = makeFakeLeadPage({
      "https://www.acme.com": {
        title: "Acme Inc",
        text: "Acme Inc homepage with nothing else on it.",
        internalLinks: [],
      },
    });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const result = await provider.findCompany("Acme", null);

    expect(result.status).toBe("SUCCESS");
    const company = result.data!;
    expect(company.foundedYear).toBeNull();
    expect(company.industry).toBeNull();
    expect(company.contactUrl).toBeNull();
    expect(company.publicBusinessEmail).toBeNull();
    expect(company.publicBusinessPhone).toBeNull();
    expect(company.linkedinUrl).toBeNull();
  });

  it("findCompany: does not claim a domain-guessed site is the company when the brand never appears on it", async () => {
    const fakePage = makeFakeLeadPage({
      "https://www.acme.com": {
        title: "Totally Unrelated Business",
        text: "This page has nothing to do with the brand we searched for.",
        internalLinks: [],
      },
    });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const result = await provider.findCompany("Acme", null);

    expect(result.status).toBe("SUCCESS");
    expect(result.data).toBeNull();
  });

  it("findCompany: tries the core brand name's domain (stripped of a corporate-entity suffix) before the always-wrong full-legal-name guess", async () => {
    // Regression: searching "Revlon Consumer Products Corp." (the legal
    // entity, not the consumer brand) used to only ever try
    // "revlonconsumerproductscorp.com", which doesn't exist — the real
    // site is revlon.com. This is real user-observed behavior, not a
    // hypothetical.
    const fakePage = makeFakeLeadPage({
      "https://www.revlon.com": {
        // Matches the real revlon.com <title> shape: tagline FIRST, brand
        // name second — the naive "first segment is the name" assumption
        // gets this wrong, which extractCompanyName's preferredMatch
        // parameter now corrects.
        title: "Makeup, Hair Color, Nails, Beauty Products & Tools | Revlon – Revlon US",
        text: "Revlon is a global beauty company.",
        internalLinks: [],
      },
      // The old always-tried, always-wrong guess is deliberately left
      // undefined in this fixture (goto would 404/timeout in reality) —
      // makeFakeLeadPage's evaluate returns "" for undefined pages, which
      // won't verify against "Revlon" either way, proving the correct
      // candidate is the one actually used.
    });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const result = await provider.findCompany("Revlon Consumer Products Corp.", null);

    expect(result.status).toBe("SUCCESS");
    const company = result.data!;
    expect(company.domain).toBe("revlon.com");
    expect(company.website).toBe("https://www.revlon.com");
    expect(company.name).toBe("Revlon");
  });

  it("findCompany: rejects a run-together nav menu as the description (real observed case: a site whose innerText concatenates nav items with no separators)", async () => {
    const fakePage = makeFakeLeadPage({
      "https://www.acme.com": {
        title: "Acme",
        // First line is a real nav-menu artifact (ALL CAPS, near-zero
        // spaces relative to length) — must be skipped in favor of the
        // real sentence below it.
        text: "ACME NEWFACELIPSEYESBEAUTY TOOLSHAIRNAILSCOLLECTIONSBEAUTY LABBLOG\nAcme makes tools that help people build better things every day of the week.",
        internalLinks: [],
      },
    });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const result = await provider.findCompany("Acme", null);

    expect(result.status).toBe("SUCCESS");
    expect(result.data!.description).toBe("Acme makes tools that help people build better things every day of the week.");
  });

  it("findCompany: a navigation failure (no such site) is honest 'nothing found', not an ERROR", async () => {
    const fakePage = {
      setDefaultNavigationTimeout: vi.fn(),
      goto: vi.fn(async () => {
        throw new Error("net::ERR_NAME_NOT_RESOLVED");
      }),
      title: vi.fn(async () => ""),
      url: vi.fn(() => ""),
      evaluate: vi.fn(async () => null),
    };
    vi.doMock("playwright", () => makePlaywrightMock(fakePage as any));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const result = await provider.findCompany("NoSuchBrand", null);

    expect(result.status).toBe("SUCCESS");
    expect(result.data).toBeNull();
  });

  it("findDecisionMakers: extracts name/title pairs from a dedicated team page and captures a company-published LinkedIn link", async () => {
    const fakePage = makeFakeLeadPage({
      "https://www.acme.com": {
        title: "Acme Inc",
        text: "Acme Inc homepage.",
        internalLinks: [{ href: "https://www.acme.com/team", text: "Our Team" }],
      },
      "https://www.acme.com/team": {
        title: "Team | Acme Inc",
        text: "Jordan Bennett - Founder & CEO\n\nTaylor Clarke - Head of E-commerce",
        linkedinLinks: [{ href: "https://www.linkedin.com/in/jordan-bennett", nearbyText: "Jordan Bennett Founder & CEO" }],
      },
    });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const company: DiscoveredCompany = {
      name: "Acme Inc",
      domain: "acme.com",
      website: "https://www.acme.com",
      description: null,
      employeeRange: null,
      location: "Austin, TX",
    };
    const result = await provider.findDecisionMakers(company);

    expect(result.status).toBe("SUCCESS");
    const people = result.data!;
    expect(people).toHaveLength(2);
    const jordan = people.find((p) => p.name === "Jordan Bennett")!;
    expect(jordan.jobTitle).toBe("Founder & CEO");
    expect(jordan.roleCategory).toBe("FOUNDER");
    expect(jordan.linkedinUrl).toBe("https://www.linkedin.com/in/jordan-bennett");
    expect(jordan.linkedinStatus).toBe("FOUND");
    expect(jordan.confidence).toBeCloseTo(0.85);
    const taylor = people.find((p) => p.name === "Taylor Clarke")!;
    expect(taylor.roleCategory).toBe("ECOMMERCE");
    expect(taylor.linkedinUrl).toBeNull();
    expect(taylor.linkedinStatus).toBe("NOT_FOUND");
  });

  it("findDecisionMakers: captures a trailing headline clause and the literal matched text as evidence", async () => {
    const fakePage = makeFakeLeadPage({
      "https://www.acme.com": {
        title: "Acme Inc",
        text: "Acme Inc homepage.",
        internalLinks: [{ href: "https://www.acme.com/team", text: "Our Team" }],
      },
      "https://www.acme.com/team": {
        title: "Team | Acme Inc",
        text: "Jane Doe - Marketing Director, obsessed with brand storytelling since 2010",
      },
    });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const company: DiscoveredCompany = {
      name: "Acme Inc",
      domain: "acme.com",
      website: "https://www.acme.com",
      description: null,
      employeeRange: null,
      location: null,
    };
    const result = await provider.findDecisionMakers(company);

    expect(result.status).toBe("SUCCESS");
    const jane = result.data!.find((p) => p.name === "Jane Doe")!;
    expect(jane.jobTitle).toBe("Marketing Director");
    expect(jane.roleCategory).toBe("MARKETING");
    expect(jane.headline).toBe("obsessed with brand storytelling since 2010");
    expect(jane.evidence).toEqual(["Jane Doe - Marketing Director, obsessed with brand storytelling since 2010"]);
  });

  it("findDecisionMakers: extracts a 'stacked' Name / Title / Location team-listing layout (no inline separator) with a per-person location and higher confidence than prose", async () => {
    const fakePage = makeFakeLeadPage({
      "https://buffer.com": {
        title: "Buffer",
        text: "Buffer homepage.",
        internalLinks: [{ href: "https://buffer.com/about", text: "About" }],
      },
      "https://buffer.com/about": {
        title: "About | Buffer",
        text: "ABOUT US\n\nWe're Buffer\n\nJoel Gascoigne\n\nCEO & Co-Founder\n\nChicago, USA\n\nAndy Yates\n\nStaff Engineer\n\nSan Francisco, USA",
      },
    });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const company: DiscoveredCompany = {
      name: "Buffer",
      domain: "buffer.com",
      website: "https://buffer.com",
      description: null,
      employeeRange: null,
      location: "Brighton, UK",
    };
    const result = await provider.findDecisionMakers(company);

    expect(result.status).toBe("SUCCESS");
    const joel = result.data!.find((p) => p.name === "Joel Gascoigne")!;
    expect(joel).toBeDefined();
    expect(joel.jobTitle).toBe("CEO & Co-Founder");
    expect(joel.roleCategory).toBe("FOUNDER");
    expect(joel.location).toBe("Chicago, USA"); // per-person location, not company.location
    expect(joel.confidence).toBeCloseTo(0.9); // stacked layout + found on a non-homepage page (About)

    // "Staff Engineer" isn't one of the recognized business-relevant roles
    // (see ROLE_PATTERNS) — never invented as a decision maker.
    expect(result.data!.find((p) => p.name === "Andy Yates")).toBeUndefined();
  });

  it("findDecisionMakers: strips a leading sentence-filler word from a name found in narrative prose (never invents, never keeps 'I'm' as part of the name)", async () => {
    const fakePage = makeFakeLeadPage({
      "https://basecamp.com": {
        title: "Basecamp",
        text: "Born out of necessity. I'm Jason Fried, one of the co-founders here at Basecamp.",
        internalLinks: [],
      },
    });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const company: DiscoveredCompany = {
      name: "Basecamp",
      domain: "basecamp.com",
      website: "https://basecamp.com",
      description: null,
      employeeRange: null,
      location: null,
    };
    const result = await provider.findDecisionMakers(company);

    expect(result.status).toBe("SUCCESS");
    const people = result.data!;
    expect(people).toHaveLength(1);
    expect(people[0].name).toBe("Jason Fried");
    expect(people[0].roleCategory).toBe("FOUNDER");
  });

  it("findDecisionMakers: never invents a person — returns an empty array when no matching role text is found", async () => {
    const fakePage = makeFakeLeadPage({
      "https://www.acme.com": {
        title: "Acme Inc",
        text: "Acme Inc sells great widgets. No team information here.",
        internalLinks: [],
      },
    });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const company: DiscoveredCompany = {
      name: "Acme Inc",
      domain: "acme.com",
      website: "https://www.acme.com",
      description: null,
      employeeRange: null,
      location: null,
    };
    const result = await provider.findDecisionMakers(company);

    expect(result.status).toBe("SUCCESS");
    expect(result.data).toEqual([]);
  });

  it("findDecisionMakers: SUCCESS with [] immediately when the company has no website (never guesses one)", async () => {
    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const company: DiscoveredCompany = { name: "Acme Inc", domain: null, website: null, description: null, employeeRange: null, location: null };
    const result = await provider.findDecisionMakers(company);

    expect(result.status).toBe("SUCCESS");
    expect(result.data).toEqual([]);
  });

  it("returns an ERROR result (never throws) when the browser fails to launch", async () => {
    vi.doMock("playwright", () => ({
      chromium: { launch: vi.fn(async () => { throw new Error("Executable doesn't exist — run playwright install chromium"); }) },
    }));

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const result = await provider.findCompany("Acme", null);

    expect(result.status).toBe("ERROR");
    expect(result.data).toBeNull();
    expect(result.errorMessage).toContain("Executable doesn't exist");
  });

  it("returns an ERROR result with an install hint when the playwright package itself is unavailable", async () => {
    vi.doMock("playwright", () => {
      throw new Error("Cannot find module 'playwright'");
    });

    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    const result = await provider.findCompany("Acme", null);

    expect(result.status).toBe("ERROR");
    expect(result.errorMessage).toContain("playwright:install");
  });

  it("reports CONFIGURED status without requiring any API key", async () => {
    const { PlaywrightLeadProvider } = await import("@/lib/providers/lead/playwright");
    const provider = new PlaywrightLeadProvider();
    expect(provider.status()).toBe("CONFIGURED");
  });
});

// --- fixtures ------------------------------------------------------------

function makeFakeLeadPage(pages: Record<string, FakePageData>) {
  let currentUrl = "";
  return {
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn(async (url: string) => {
      currentUrl = url;
    }),
    title: vi.fn(async () => pages[currentUrl]?.title ?? ""),
    url: vi.fn(() => currentUrl),
    evaluate: vi.fn(async (fn: (...args: unknown[]) => unknown) => {
      const src = fn.toString();
      const data = pages[currentUrl];
      if (src.includes("mailto:")) return { mailtoEmails: data?.mailtoEmails ?? [], telPhones: data?.telPhones ?? [] };
      if (src.includes("ld+json")) return data?.jsonLdIndustry ?? null;
      if (!data) return src.includes("linkedin.com/in") || src.includes("a[href]") ? [] : "";
      if (src.includes("innerText")) return data.text;
      if (src.includes("linkedin.com/in")) return data.linkedinLinks ?? [];
      if (src.includes('a[href]')) return data.internalLinks ?? [];
      return null;
    }),
  };
}

function makePlaywrightMock(fakePage: ReturnType<typeof makeFakeLeadPage>) {
  const fakeContext = { newPage: vi.fn(async () => fakePage) };
  const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn(async () => {}) };
  return { chromium: { launch: vi.fn(async () => fakeBrowser) } };
}
