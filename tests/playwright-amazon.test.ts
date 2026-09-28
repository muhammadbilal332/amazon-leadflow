import { afterEach, describe, expect, it, vi } from "vitest";

// The provider only ever does `await import("playwright")` inside its
// methods (never a top-level import — see lib/providers/amazon/playwright.ts
// for why), so mocking the "playwright" module specifier here intercepts
// that dynamic import too. This lets us test the real extraction/mapping
// logic against a fake DOM without ever launching a real browser or
// touching a live Amazon page, per the "no live-page dependency in the
// normal test suite" requirement.

function fakeElement(overrides: { attr?: Record<string, string | null>; text?: string | null; children?: Record<string, any> } = {}) {
  return {
    getAttribute: vi.fn(async (name: string) => overrides.attr?.[name] ?? null),
    textContent: vi.fn(async () => overrides.text ?? null),
    $: vi.fn(async (selector: string) => overrides.children?.[selector] ?? null),
  };
}

describe("PlaywrightAmazonProvider", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("playwright");
  });

  it("maps a full search tile into the normalized DiscoveredProduct shape", async () => {
    const tile = fakeElement({
      attr: { "data-asin": "B0TEST1234" },
      children: {
        "h2 a span": fakeElement({ text: "Acme Widget Pro" }),
        "h2 a": fakeElement({ attr: { href: "/dp/B0TEST1234" } }),
        ".a-price .a-offscreen": fakeElement({ text: "$24.99" }),
        "span.a-icon-alt": fakeElement({ text: "4.5 out of 5 stars" }),
        'span[aria-label$="ratings"]': fakeElement({ text: "1,234 ratings" }),
        "img.s-image": fakeElement({ attr: { src: "https://m.media-amazon.com/images/I/test.jpg" } }),
      },
    });

    const fakePage = makeFakePage({ tiles: [tile], detail: standardDetailHandlers() });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightAmazonProvider } = await import("@/lib/providers/amazon/playwright");
    const provider = new PlaywrightAmazonProvider();
    const result = await provider.searchByBrand("Acme", "amazon.com");

    expect(result.status).toBe("SUCCESS");
    expect(result.data).toHaveLength(1);
    const product = result.data![0];
    expect(product.asin).toBe("B0TEST1234");
    expect(product.title).toBe("Acme Widget Pro");
    expect(product.price).toBeCloseTo(24.99);
    expect(product.currency).toBe("USD");
    expect(product.rating).toBeCloseTo(4.5);
    expect(product.reviewCount).toBe(1234);
    expect(product.images).toEqual([{ url: "https://m.media-amazon.com/images/I/test.jpg", position: 0, isMain: true }]);
    expect(product.url).toContain("B0TEST1234");
  });

  it("leaves fields null instead of fabricating them when the tile is missing data", async () => {
    const tile = fakeElement({
      attr: { "data-asin": "B0NODATA01" },
      children: {
        "h2 a span": fakeElement({ text: "Bare Bones Product" }),
        "h2 a": fakeElement({ attr: { href: null } }),
        // no price, rating, review, or image elements at all
      },
    });

    const fakePage = makeFakePage({ tiles: [tile], detail: emptyDetailHandlers() });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightAmazonProvider } = await import("@/lib/providers/amazon/playwright");
    const provider = new PlaywrightAmazonProvider();
    const result = await provider.searchByBrand("Acme", "amazon.com");

    expect(result.status).toBe("SUCCESS");
    const product = result.data![0];
    expect(product.price).toBeNull();
    expect(product.rating).toBeNull();
    expect(product.reviewCount).toBeNull();
    expect(product.images).toEqual([]);
    expect(product.bulletPoints).toEqual([]);
    expect(product.description).toBeNull();
    expect(product.brandLabel).toBeNull();
  });

  it("skips a malformed tile without failing the whole scrape", async () => {
    const throwingTile = { getAttribute: vi.fn(async () => { throw new Error("detached DOM node"); }), $: vi.fn(), textContent: vi.fn() };
    const goodTile = fakeElement({
      attr: { "data-asin": "B0GOOD0001" },
      children: { "h2 a span": fakeElement({ text: "Good Product" }), "h2 a": fakeElement({ attr: { href: "/dp/B0GOOD0001" } }) },
    });

    const fakePage = makeFakePage({ tiles: [throwingTile, goodTile], detail: emptyDetailHandlers() });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightAmazonProvider } = await import("@/lib/providers/amazon/playwright");
    const provider = new PlaywrightAmazonProvider();
    const result = await provider.searchByBrand("Acme", "amazon.com");

    expect(result.status).toBe("SUCCESS");
    expect(result.data).toHaveLength(1);
    expect(result.data![0].asin).toBe("B0GOOD0001");
  });

  it("returns SUCCESS with an empty array when zero results are found (not an error)", async () => {
    const fakePage = makeFakePage({ tiles: [], detail: emptyDetailHandlers() });
    vi.doMock("playwright", () => makePlaywrightMock(fakePage));

    const { PlaywrightAmazonProvider } = await import("@/lib/providers/amazon/playwright");
    const provider = new PlaywrightAmazonProvider();
    const result = await provider.searchByBrand("NoSuchBrandAtAll", "amazon.com");

    expect(result.status).toBe("SUCCESS");
    expect(result.data).toEqual([]);
  });

  it("returns an ERROR result (never throws) when the browser fails to launch", async () => {
    vi.doMock("playwright", () => ({
      chromium: { launch: vi.fn(async () => { throw new Error("Executable doesn't exist — run playwright install chromium"); }) },
    }));

    const { PlaywrightAmazonProvider } = await import("@/lib/providers/amazon/playwright");
    const provider = new PlaywrightAmazonProvider();
    const result = await provider.searchByBrand("Acme", "amazon.com");

    expect(result.status).toBe("ERROR");
    expect(result.data).toBeNull();
    expect(result.errorMessage).toContain("Executable doesn't exist");
  });

  it("returns an ERROR result with an install hint when the playwright package itself is unavailable", async () => {
    vi.doMock("playwright", () => {
      throw new Error("Cannot find module 'playwright'");
    });

    const { PlaywrightAmazonProvider } = await import("@/lib/providers/amazon/playwright");
    const provider = new PlaywrightAmazonProvider();
    const result = await provider.searchByBrand("Acme", "amazon.com");

    expect(result.status).toBe("ERROR");
    expect(result.errorMessage).toContain("playwright:install");
  });

  it("reports CONFIGURED status without requiring any API key", async () => {
    const { PlaywrightAmazonProvider } = await import("@/lib/providers/amazon/playwright");
    const provider = new PlaywrightAmazonProvider();
    expect(provider.status()).toBe("CONFIGURED");
  });
});

// --- fixtures ------------------------------------------------------------

function standardDetailHandlers() {
  return {
    "#feature-bullets ul li span.a-list-item": [fakeElement({ text: "Durable materials" }), fakeElement({ text: "Easy to use" })],
    "#productDescription": fakeElement({ text: "A great product for everyday use." }),
    "#bylineInfo": fakeElement({ text: "Visit the Acme Store" }),
  };
}

function emptyDetailHandlers() {
  return {
    "#feature-bullets ul li span.a-list-item": [],
    "#productDescription": null,
    "#feature-bullets": null,
    "#bylineInfo": null,
  };
}

function makeFakePage(opts: { tiles: any[]; detail: Record<string, any> }) {
  return {
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    $$: vi.fn(async (selector: string) => {
      if (selector.includes("s-search-result")) return opts.tiles;
      if (selector in opts.detail) return opts.detail[selector] ?? [];
      return [];
    }),
    $: vi.fn(async (selector: string) => (selector in opts.detail ? opts.detail[selector] : null)),
  };
}

function makePlaywrightMock(fakePage: ReturnType<typeof makeFakePage>) {
  const fakeContext = { newPage: vi.fn(async () => fakePage) };
  const fakeBrowser = { newContext: vi.fn(async () => fakeContext), close: vi.fn(async () => {}) };
  return { chromium: { launch: vi.fn(async () => fakeBrowser) } };
}
