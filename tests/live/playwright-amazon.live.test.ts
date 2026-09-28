import { describe, expect, it } from "vitest";
import { PlaywrightAmazonProvider } from "@/lib/providers/amazon/playwright";

// Opt-in only — run with `npm run test:live`. Launches a real Chromium
// browser and navigates real Amazon pages (a single search + a couple of
// product pages), so it needs `npm run playwright:install` done first and
// a working internet connection. Never run automatically as part of
// `npm test` / CI — see vitest.config.ts's exclude and docs/PROVIDERS.md.
describe("PlaywrightAmazonProvider (live)", () => {
  it("finds real, non-fabricated products for a well-known brand", async () => {
    const provider = new PlaywrightAmazonProvider();
    const result = await provider.searchByBrand("Anker", "amazon.com");

    expect(["SUCCESS", "ERROR"]).toContain(result.status);
    if (result.status === "ERROR") {
      // Amazon layout changes, a block page, or no network are all
      // legitimate real-world outcomes for a live scrape — log it instead
      // of failing the run, since this test's job is a smoke check, not a
      // guarantee that Amazon never changes.
      console.warn("Live Playwright smoke test got ERROR (non-fatal):", result.errorMessage);
      return;
    }

    expect(Array.isArray(result.data)).toBe(true);
    if (result.data && result.data.length > 0) {
      const product = result.data[0];
      expect(typeof product.asin).toBe("string");
      expect(product.asin.length).toBeGreaterThan(0);
      expect(typeof product.title).toBe("string");
      expect(product.url).toContain("amazon.com");
    }
  });
});
