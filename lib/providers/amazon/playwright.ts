import type { AmazonProvider, DiscoveredProduct, ProviderResult } from "@/lib/providers/types";
import type { ProviderStatus } from "@/types/database";

// `playwright` is only ever imported dynamically inside the methods below
// (not at module top level). This keeps it out of every route's bundle
// that merely imports the provider registry — the same lesson learned
// from removing the `googleapis` SDK earlier: a large dependency imported
// at module scope gets pulled into every page that transitively reaches
// this file, even pages that never touch Amazon discovery.
type PlaywrightModule = typeof import("playwright");

const NAV_TIMEOUT_MS = 20_000;
/** Delay between product-detail page visits — the only throttling this
 * provider needs, since search results are fetched in a single request.
 * No stealth, no proxy rotation, no CAPTCHA handling: if Amazon serves a
 * block/verification page, extraction below yields few or zero results and
 * that's reported as-is (falls through to the mock provider in the chain),
 * never worked around. */
const DETAIL_PAGE_DELAY_MS = 1_500;
/** Cap how many product pages we open for bullet points/description —
 * keeps a single search from turning into dozens of requests. */
const MAX_DETAIL_PAGES = 5;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface SearchResultBasics {
  asin: string;
  title: string;
  url: string;
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  imageUrl: string | null;
}

/** Real Amazon discovery via a real, unauthenticated browser session
 * (Playwright + Chromium) — no API key, no scraping service, no paid
 * plan. Collects only what's visible in the normal public browsing
 * experience: the search results page and, for a handful of top results,
 * their public product pages. Selected via `AMAZON_PROVIDER=playwright`;
 * see lib/providers/registry.ts. */
export class PlaywrightAmazonProvider implements AmazonProvider {
  readonly name = "playwright-amazon";

  status(): ProviderStatus {
    // No credential to check — Chromium's presence is only verified when
    // actually launched, since `playwright install chromium` is a
    // separate, possibly-not-yet-run step from `npm install`.
    return "CONFIGURED";
  }

  async searchByBrand(brand: string, marketplace: string): Promise<ProviderResult<DiscoveredProduct[]>> {
    const start = Date.now();
    let playwright: PlaywrightModule;
    try {
      playwright = await import("playwright");
    } catch (err) {
      return {
        status: "ERROR",
        data: null,
        durationMs: Date.now() - start,
        errorMessage:
          "playwright package not installed. Run: npm install, then: npm run playwright:install " +
          `(${err instanceof Error ? err.message : "unknown error"})`,
      };
    }

    let browser: Awaited<ReturnType<PlaywrightModule["chromium"]["launch"]>> | null = null;
    try {
      browser = await playwright.chromium.launch({ headless: true });
      const context = await browser.newContext({ userAgent: USER_AGENT });
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

      const searchUrl = `https://www.${marketplace}/s?k=${encodeURIComponent(brand)}`;
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

      const basics = await extractSearchResults(page, marketplace);

      const products: DiscoveredProduct[] = [];
      for (let i = 0; i < basics.length; i++) {
        const b = basics[i];
        let detail: { bulletPoints: string[]; description: string | null; brandLabel: string | null } = {
          bulletPoints: [],
          description: null,
          brandLabel: null,
        };

        if (i < MAX_DETAIL_PAGES) {
          if (i > 0) await page.waitForTimeout(DETAIL_PAGE_DELAY_MS);
          detail = await extractProductDetail(page, b.url).catch(() => detail);
        }

        products.push({
          asin: b.asin,
          title: b.title,
          brandLabel: detail.brandLabel,
          sellerName: null, // not reliably exposed without extra buy-box requests we don't make
          sellerCount: null,
          price: b.price,
          currency: b.price !== null ? "USD" : null,
          rating: b.rating,
          reviewCount: b.reviewCount,
          url: b.url,
          bulletPoints: detail.bulletPoints,
          description: detail.description,
          images: b.imageUrl ? [{ url: b.imageUrl, position: 0, isMain: true }] : [],
        });
      }

      return { status: "SUCCESS", data: products, durationMs: Date.now() - start, requestIdentifier: `playwright:${brand}` };
    } catch (err) {
      return {
        status: "ERROR",
        data: null,
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : "unknown error",
      };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
}

async function extractSearchResults(
  page: import("playwright").Page,
  marketplace: string,
): Promise<SearchResultBasics[]> {
  const tiles = await page.$$('div[data-component-type="s-search-result"][data-asin]');
  const basics: SearchResultBasics[] = [];

  for (const tile of tiles) {
    try {
      const asin = await tile.getAttribute("data-asin");
      if (!asin) continue;

      const titleEl = (await tile.$("h2 a span")) ?? (await tile.$("h2 span"));
      const title = titleEl ? (await titleEl.textContent())?.trim() : null;
      if (!title) continue; // sponsored placeholders / layout slots without a real product

      const linkEl = await tile.$("h2 a");
      const href = linkEl ? await linkEl.getAttribute("href") : null;
      const url = href ? new URL(href, `https://www.${marketplace}`).toString() : `https://www.${marketplace}/dp/${asin}`;

      const priceEl = await tile.$(".a-price .a-offscreen");
      const priceText = priceEl ? await priceEl.textContent() : null;
      const price = priceText ? parseFloat(priceText.replace(/[^0-9.]/g, "")) : null;

      const ratingEl = await tile.$("span.a-icon-alt");
      const ratingText = ratingEl ? await ratingEl.textContent() : null;
      const ratingMatch = ratingText?.match(/([\d.]+)\s*out of/i);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

      const reviewEl = (await tile.$('span[aria-label$="ratings"]')) ?? (await tile.$("span.a-size-base.s-underline-text"));
      const reviewText = reviewEl ? await reviewEl.textContent() : null;
      const reviewDigits = reviewText?.replace(/[^0-9]/g, "");
      const reviewCount = reviewDigits ? parseInt(reviewDigits, 10) : null;

      const imgEl = await tile.$("img.s-image");
      const imageUrl = imgEl ? await imgEl.getAttribute("src") : null;

      basics.push({
        asin,
        title,
        url,
        price: Number.isFinite(price) ? price : null,
        rating: Number.isFinite(rating) ? rating : null,
        reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
        imageUrl,
      });
    } catch {
      // One malformed/unexpected tile shouldn't abort the whole scrape.
      continue;
    }
  }

  return basics;
}

async function extractProductDetail(
  page: import("playwright").Page,
  url: string,
): Promise<{ bulletPoints: string[]; description: string | null; brandLabel: string | null }> {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  const bulletEls = await page.$$("#feature-bullets ul li span.a-list-item");
  const bulletPoints = (
    await Promise.all(bulletEls.map((el) => el.textContent()))
  )
    .map((t) => t?.trim() ?? "")
    .filter(Boolean);

  const descEl = (await page.$("#productDescription")) ?? (await page.$("#feature-bullets"));
  const descriptionRaw = descEl ? await descEl.textContent() : null;
  const description = descriptionRaw ? descriptionRaw.trim().replace(/\s+/g, " ") || null : null;

  const brandEl = await page.$("#bylineInfo");
  const brandTextRaw = brandEl ? await brandEl.textContent() : null;
  const brandLabel = brandTextRaw
    ? brandTextRaw.replace(/^Visit the\s+/i, "").replace(/\s+Store$/i, "").replace(/^Brand:\s*/i, "").trim() || null
    : null;

  return { bulletPoints, description, brandLabel };
}
