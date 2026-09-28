import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { arePaidApisEnabled, isDemoMode, quotaTracker } from "@/lib/providers/config";

const ORIGINAL_ENV = { ...process.env };

describe("safety switches", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to demo mode when DEMO_MODE is unset", () => {
    delete process.env.DEMO_MODE;
    expect(isDemoMode()).toBe(true);
  });

  it("only exits demo mode when DEMO_MODE is exactly 'false'", () => {
    process.env.DEMO_MODE = "false";
    expect(isDemoMode()).toBe(false);
    process.env.DEMO_MODE = "no";
    expect(isDemoMode()).toBe(true);
  });

  it("defaults paid APIs to disabled when PAID_APIS_ENABLED is unset", () => {
    delete process.env.PAID_APIS_ENABLED;
    expect(arePaidApisEnabled()).toBe(false);
  });

  it("only enables paid APIs when PAID_APIS_ENABLED is exactly 'true'", () => {
    process.env.PAID_APIS_ENABLED = "true";
    expect(arePaidApisEnabled()).toBe(true);
    process.env.PAID_APIS_ENABLED = "TRUE";
    expect(arePaidApisEnabled()).toBe(false);
    process.env.PAID_APIS_ENABLED = "1";
    expect(arePaidApisEnabled()).toBe(false);
  });
});

describe("quotaTracker", () => {
  it("tracks exhaustion per-provider without affecting other providers", () => {
    expect(quotaTracker.isExhausted("test-provider-a")).toBe(false);
    quotaTracker.markExhausted("test-provider-a");
    expect(quotaTracker.isExhausted("test-provider-a")).toBe(true);
    expect(quotaTracker.isExhausted("test-provider-b")).toBe(false);
  });
});

describe("provider chain composition", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SERPAPI_API_KEY;
    delete process.env.HUNTER_API_KEY;
    delete process.env.APOLLO_API_KEY;
    delete process.env.AI_API_KEY;
    delete process.env.PAID_APIS_ENABLED;
    delete process.env.AMAZON_PROVIDER;
    delete process.env.LEAD_PROVIDER;
  });

  it("excludes Amazon/lead/email real providers when no keys are configured, even outside demo mode", async () => {
    // Unlike AI (still gated on DEMO_MODE alone — it has no free tier at
    // all), Amazon/lead/email real providers are now gated purely on their
    // own API key being present, so this must hold even with DEMO_MODE=false.
    process.env.DEMO_MODE = "false";
    const { amazonProviderChain, leadProviderChain, emailProviderChain, hasRealAmazonProvider, hasRealLeadProvider, hasRealEmailProvider } =
      await import("@/lib/providers/registry");
    expect(amazonProviderChain().map((p) => p.name)).toEqual(["mock-amazon"]);
    expect(leadProviderChain().map((p) => p.name)).toEqual(["mock-lead"]);
    expect(emailProviderChain().map((p) => p.name)).toEqual(["mock-email"]);
    expect(hasRealAmazonProvider()).toBe(false);
    expect(hasRealLeadProvider()).toBe(false);
    expect(hasRealEmailProvider()).toBe(false);
  });

  it("still excludes the real AI provider in demo mode even with no key configured", async () => {
    process.env.DEMO_MODE = "true";
    const { aiProviderChain } = await import("@/lib/providers/registry");
    expect(aiProviderChain().map((p) => p.name)).toEqual(["mock-ai"]);
  });

  it("includes SerpApi whenever SERPAPI_API_KEY is set, regardless of DEMO_MODE", async () => {
    process.env.DEMO_MODE = "true";
    process.env.SERPAPI_API_KEY = "test-key";
    const { amazonProviderChain, hasRealAmazonProvider } = await import("@/lib/providers/registry");
    expect(amazonProviderChain().map((p) => p.name)).toEqual(["serpapi-amazon", "mock-amazon"]);
    expect(hasRealAmazonProvider()).toBe(true);
  });

  it("includes Hunter's free-tier lead + email providers whenever HUNTER_API_KEY is set, regardless of DEMO_MODE", async () => {
    process.env.DEMO_MODE = "true";
    process.env.HUNTER_API_KEY = "test-key";
    const { leadProviderChain, emailProviderChain, hasRealLeadProvider, hasRealEmailProvider } = await import("@/lib/providers/registry");
    expect(leadProviderChain().map((p) => p.name)).toEqual(["hunter-domain-search", "mock-lead"]);
    expect(emailProviderChain().map((p) => p.name)).toEqual(["hunter", "mock-email"]);
    expect(hasRealLeadProvider()).toBe(true);
    expect(hasRealEmailProvider()).toBe(true);
  });

  it("never includes Apollo unless both APOLLO_API_KEY and PAID_APIS_ENABLED=true are set", async () => {
    process.env.APOLLO_API_KEY = "test-key";
    process.env.PAID_APIS_ENABLED = "false";
    let { leadProviderChain, hasRealLeadProvider } = await import("@/lib/providers/registry");
    expect(leadProviderChain().map((p) => p.name)).toEqual(["mock-lead"]);
    expect(hasRealLeadProvider()).toBe(false);

    process.env.PAID_APIS_ENABLED = "true";
    ({ leadProviderChain, hasRealLeadProvider } = await import("@/lib/providers/registry"));
    expect(leadProviderChain().map((p) => p.name)).toEqual(["apollo", "mock-lead"]);
    expect(hasRealLeadProvider()).toBe(true);
  });

  it("selects PlaywrightAmazonProvider when AMAZON_PROVIDER=playwright, with no API key required", async () => {
    process.env.AMAZON_PROVIDER = "playwright";
    const { amazonProviderChain, hasRealAmazonProvider } = await import("@/lib/providers/registry");
    expect(amazonProviderChain().map((p) => p.name)).toEqual(["playwright-amazon", "mock-amazon"]);
    expect(hasRealAmazonProvider()).toBe(true);
  });

  it("AMAZON_PROVIDER=playwright takes priority over SERPAPI_API_KEY when both are set", async () => {
    process.env.AMAZON_PROVIDER = "playwright";
    process.env.SERPAPI_API_KEY = "test-key";
    const { amazonProviderChain } = await import("@/lib/providers/registry");
    expect(amazonProviderChain().map((p) => p.name)).toEqual(["playwright-amazon", "mock-amazon"]);
  });

  it("AMAZON_PROVIDER=mock forces mock data even when SERPAPI_API_KEY is set", async () => {
    process.env.AMAZON_PROVIDER = "mock";
    process.env.SERPAPI_API_KEY = "test-key";
    const { amazonProviderChain, hasRealAmazonProvider } = await import("@/lib/providers/registry");
    expect(amazonProviderChain().map((p) => p.name)).toEqual(["mock-amazon"]);
    expect(hasRealAmazonProvider()).toBe(false);
  });

  it("an unset AMAZON_PROVIDER preserves the original SerpApi-if-key-present behavior", async () => {
    process.env.SERPAPI_API_KEY = "test-key";
    const { amazonProviderChain, hasRealAmazonProvider } = await import("@/lib/providers/registry");
    expect(amazonProviderChain().map((p) => p.name)).toEqual(["serpapi-amazon", "mock-amazon"]);
    expect(hasRealAmazonProvider()).toBe(true);
  });

  it("selects PlaywrightLeadProvider when LEAD_PROVIDER=playwright, with no API key required", async () => {
    process.env.LEAD_PROVIDER = "playwright";
    const { leadProviderChain, hasRealLeadProvider } = await import("@/lib/providers/registry");
    expect(leadProviderChain().map((p) => p.name)).toEqual(["playwright-lead", "mock-lead"]);
    expect(hasRealLeadProvider()).toBe(true);
  });

  it("LEAD_PROVIDER=playwright takes priority over HUNTER_API_KEY/APOLLO_API_KEY when both are set", async () => {
    process.env.LEAD_PROVIDER = "playwright";
    process.env.HUNTER_API_KEY = "test-key";
    process.env.APOLLO_API_KEY = "test-key";
    process.env.PAID_APIS_ENABLED = "true";
    const { leadProviderChain } = await import("@/lib/providers/registry");
    expect(leadProviderChain().map((p) => p.name)).toEqual(["playwright-lead", "mock-lead"]);
  });

  it("LEAD_PROVIDER=mock forces mock data even when HUNTER_API_KEY is set", async () => {
    process.env.LEAD_PROVIDER = "mock";
    process.env.HUNTER_API_KEY = "test-key";
    const { leadProviderChain, hasRealLeadProvider } = await import("@/lib/providers/registry");
    expect(leadProviderChain().map((p) => p.name)).toEqual(["mock-lead"]);
    expect(hasRealLeadProvider()).toBe(false);
  });

  it("an unset LEAD_PROVIDER preserves the original Hunter/Apollo-if-key-present behavior", async () => {
    process.env.HUNTER_API_KEY = "test-key";
    const { leadProviderChain, hasRealLeadProvider } = await import("@/lib/providers/registry");
    expect(leadProviderChain().map((p) => p.name)).toEqual(["hunter-domain-search", "mock-lead"]);
    expect(hasRealLeadProvider()).toBe(true);
  });
});
