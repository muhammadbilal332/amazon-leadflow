import { quotaTracker } from "@/lib/providers/config";
import type { AmazonProvider, DiscoveredProduct, ProviderResult } from "@/lib/providers/types";
import type { ProviderStatus } from "@/types/database";

const SERPAPI_URL = "https://serpapi.com/search.json";

/** SerpApi's Amazon search engine has a free monthly quota (100 searches).
 * We treat it as a free-tier provider: never upgraded automatically, and
 * disabled outright unless a key is present. */
export class SerpApiAmazonProvider implements AmazonProvider {
  readonly name = "serpapi-amazon";

  private get apiKey(): string | undefined {
    return process.env.SERPAPI_API_KEY;
  }

  status(): ProviderStatus {
    if (!this.apiKey) return "NOT_CONFIGURED";
    if (quotaTracker.isExhausted(this.name)) return "FREE_QUOTA_EXHAUSTED";
    return "FREE_QUOTA_UNKNOWN";
  }

  async searchByBrand(brand: string, marketplace: string): Promise<ProviderResult<DiscoveredProduct[]>> {
    const start = Date.now();

    if (!this.apiKey) {
      return { status: "SKIPPED_DISABLED", data: null, durationMs: Date.now() - start, errorMessage: "SERPAPI_API_KEY not set" };
    }
    if (quotaTracker.isExhausted(this.name)) {
      return { status: "SKIPPED_QUOTA", data: null, durationMs: Date.now() - start, errorMessage: "FREE_QUOTA_EXHAUSTED" };
    }

    const domain = marketplace === "amazon.com" ? "amazon.com" : marketplace;
    const params = new URLSearchParams({
      engine: "amazon",
      amazon_domain: domain,
      k: brand,
      api_key: this.apiKey,
    });

    try {
      const res = await fetch(`${SERPAPI_URL}?${params.toString()}`, { method: "GET" });

      if (res.status === 429) {
        quotaTracker.markExhausted(this.name);
        return { status: "SKIPPED_QUOTA", data: null, durationMs: Date.now() - start, errorMessage: "FREE_QUOTA_EXHAUSTED" };
      }
      if (!res.ok) {
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: `SerpApi HTTP ${res.status}` };
      }

      const json = (await res.json()) as {
        organic_results?: Array<Record<string, unknown>>;
        error?: string;
      };

      if (json.error) {
        if (/quota|limit/i.test(json.error)) quotaTracker.markExhausted(this.name);
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: json.error };
      }

      const products: DiscoveredProduct[] = (json.organic_results ?? []).map((r) => {
        const asin = String(r.asin ?? "");
        const thumbnail = typeof r.thumbnail === "string" ? r.thumbnail : null;
        return {
          asin,
          title: String(r.title ?? ""),
          brandLabel: null,
          sellerName: null,
          sellerCount: null,
          price: typeof r.extracted_price === "number" ? r.extracted_price : null,
          currency: "USD",
          rating: typeof r.rating === "number" ? r.rating : null,
          reviewCount: typeof r.reviews === "number" ? r.reviews : null,
          url: typeof r.link === "string" ? r.link : `https://www.${domain}/dp/${asin}`,
          bulletPoints: [],
          description: null,
          images: thumbnail ? [{ url: thumbnail, position: 0, isMain: true }] : [],
        };
      });

      return { status: "SUCCESS", data: products, durationMs: Date.now() - start, requestIdentifier: `serpapi:${brand}` };
    } catch (err) {
      return {
        status: "ERROR",
        data: null,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : "unknown error",
      };
    }
  }
}
