import { describe, expect, it } from "vitest";
import { classifyBrand } from "@/lib/classification";
import type { DiscoveredProduct } from "@/lib/providers/types";

function product(overrides: Partial<DiscoveredProduct> = {}): DiscoveredProduct {
  return {
    asin: "B0TEST0001",
    title: "Acme Widget",
    brandLabel: "Acme",
    sellerName: "Acme",
    sellerCount: 1,
    price: 19.99,
    currency: "USD",
    rating: 4.5,
    reviewCount: 100,
    url: "https://www.amazon.com/dp/B0TEST0001",
    bulletPoints: ["benefit one"],
    description: "A description",
    images: [{ url: "https://example.com/1.jpg", position: 0, isMain: true }],
    ...overrides,
  };
}

describe("classifyBrand", () => {
  it("returns UNKNOWN with zero confidence for an empty catalog", () => {
    const result = classifyBrand("Acme", []);
    expect(result.classification).toBe("UNKNOWN");
    expect(result.confidence).toBe(0);
    expect(result.evidence.catalogSize).toBe(0);
  });

  it("classifies a single-seller, brand-consistent catalog as LIKELY_PRIVATE_LABEL", () => {
    const products = [
      product({ asin: "A1", sellerCount: 1, sellerName: "Acme" }),
      product({ asin: "A2", sellerCount: 1, sellerName: "Acme" }),
      product({ asin: "A3", sellerCount: 1, sellerName: "Acme" }),
    ];
    const result = classifyBrand("Acme", products);
    expect(result.classification).toBe("LIKELY_PRIVATE_LABEL");
    expect(result.evidence.brandConsistency).toBe(true);
    expect(result.evidence.singleSellerDominant).toBe(true);
  });

  it("classifies a high multi-seller catalog as LIKELY_RESELLER", () => {
    const products = [
      product({ asin: "A1", sellerCount: 5, sellerName: "Third Party Reseller 1" }),
      product({ asin: "A2", sellerCount: 4, sellerName: "Third Party Reseller 2" }),
    ];
    const result = classifyBrand("Acme", products);
    expect(result.classification).toBe("LIKELY_RESELLER");
  });

  it("classifies a moderate multi-seller catalog as WHOLESALE", () => {
    const products = [
      product({ asin: "A1", sellerCount: 2, sellerName: "Wholesaler A" }),
      product({ asin: "A2", sellerCount: 2, sellerName: "Wholesaler B" }),
    ];
    const result = classifyBrand("Acme", products);
    expect(result.classification).toBe("WHOLESALE");
  });

  it("never claims LIKELY_PRIVATE_LABEL without at least 3 positive signals", () => {
    const products = [product({ asin: "A1", brandLabel: "Other Brand", sellerName: "Random Seller", sellerCount: 1 })];
    const result = classifyBrand("Acme", products);
    expect(result.classification).not.toBe("LIKELY_PRIVATE_LABEL");
  });
});
