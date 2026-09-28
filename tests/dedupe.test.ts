import { describe, expect, it } from "vitest";
import { brandKey, companyKey, decisionMakerKey, emailKey, normalizeBrandName, normalizeDomain, productKey } from "@/lib/dedupe";

describe("normalizeBrandName", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeBrandName("  Acme   Co  ")).toBe("acme co");
  });
});

describe("brandKey", () => {
  it("produces the same key regardless of casing or extra whitespace", () => {
    const a = brandKey("client-1", "Acme Co", "amazon.com");
    const b = brandKey("client-1", "  acme   co ", "AMAZON.COM");
    expect(a).toBe(b);
  });

  it("produces different keys for different clients (no cross-tenant collision)", () => {
    const a = brandKey("client-1", "Acme", "amazon.com");
    const b = brandKey("client-2", "Acme", "amazon.com");
    expect(a).not.toBe(b);
  });
});

describe("productKey", () => {
  it("normalizes ASIN casing so retries don't create duplicates", () => {
    expect(productKey("brand-1", "b0abc123")).toBe(productKey("brand-1", "B0ABC123"));
  });
});

describe("normalizeDomain", () => {
  it("strips protocol, www, and trailing paths", () => {
    expect(normalizeDomain("https://www.acme.com/about")).toBe("acme.com");
    expect(normalizeDomain("ACME.com")).toBe("acme.com");
  });
});

describe("companyKey", () => {
  it("falls back to a stable placeholder when no domain is known", () => {
    const a = companyKey("brand-1", null);
    const b = companyKey("brand-1", null);
    expect(a).toBe(b);
    expect(a).toContain("no-domain");
  });
});

describe("decisionMakerKey", () => {
  it("is case-insensitive on name and title", () => {
    const a = decisionMakerKey("company-1", "Jane Doe", "CEO");
    const b = decisionMakerKey("company-1", "jane doe", "ceo");
    expect(a).toBe(b);
  });
});

describe("emailKey", () => {
  it("lowercases and trims for consistent dedupe", () => {
    expect(emailKey("  Jane@Acme.com ")).toBe("jane@acme.com");
  });
});
