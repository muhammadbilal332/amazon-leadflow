import type { AmazonProvider, DiscoveredProduct, ProviderResult } from "@/lib/providers/types";

function slugAsin(seed: string, i: number): string {
  const base = seed.replace(/[^A-Z0-9]/gi, "").toUpperCase().padEnd(6, "X").slice(0, 6);
  return `B0${base}${i}`;
}

/** Deterministic, seeded mock data so the same brand name always produces
 * the same demo result — useful for screenshots and tests. */
export class MockAmazonProvider implements AmazonProvider {
  readonly name = "mock-amazon";

  status() {
    return "CONFIGURED" as const;
  }

  async searchByBrand(brand: string, marketplace: string): Promise<ProviderResult<DiscoveredProduct[]>> {
    const start = Date.now();
    const seed = brand.trim().toLowerCase();
    const isReseller = seed.length % 5 === 0;
    const count = 2 + (seed.length % 3);

    const products: DiscoveredProduct[] = Array.from({ length: count }).map((_, i) => {
      const asin = slugAsin(seed, i);
      const sellerCount = isReseller ? 3 + (i % 4) : 1;
      return {
        asin,
        title: `${brand} ${["Premium", "Pro", "Essential", "Classic"][i % 4]} ${
          ["Kit", "Set", "Bundle", "Edition"][i % 4]
        } - ${["Stainless Steel", "BPA-Free", "Heavy Duty", "Compact"][i % 4]}`,
        brandLabel: brand,
        sellerName: isReseller ? `${brand} Reseller ${i + 1}` : `${brand}`,
        sellerCount,
        price: 19.99 + i * 7.5,
        currency: "USD",
        rating: 3.6 + ((i * 7) % 14) / 10,
        reviewCount: 40 + i * 233,
        url: `https://www.${marketplace}/dp/${asin}`,
        bulletPoints: [
          "PREMIUM MATERIALS - built to last with durable construction",
          "EASY TO USE - simple setup, works out of the box",
          `${brand.toUpperCase()} QUALITY - backed by our satisfaction guarantee`,
        ],
        description: `The ${brand} product line is designed for everyday reliability. This listing covers key use cases and care instructions.`,
        images: Array.from({ length: 3 + (i % 3) }).map((__, imgI) => ({
          url: `https://m.media-amazon.com/images/mock/${asin}-${imgI + 1}.jpg`,
          position: imgI,
          isMain: imgI === 0,
        })),
      };
    });

    return {
      status: "SUCCESS",
      data: products,
      durationMs: Date.now() - start,
      requestIdentifier: `mock:${seed}`,
    };
  }
}
