import { describe, expect, it } from "vitest";
import { generateListingIssues } from "@/lib/issues";
import type { DiscoveredProduct } from "@/lib/providers/types";
import type { ComponentScores } from "@/lib/scoring";

function product(overrides: Partial<DiscoveredProduct> = {}): DiscoveredProduct {
  return {
    asin: "B0TEST0001",
    title: "Great Product",
    brandLabel: "Acme",
    sellerName: "Acme",
    sellerCount: 1,
    price: 19.99,
    currency: "USD",
    rating: 4.5,
    reviewCount: 100,
    url: "https://www.amazon.com/dp/B0TEST0001",
    bulletPoints: ["one", "two", "three", "four", "five"],
    description: "A".repeat(400),
    images: Array.from({ length: 6 }).map((_, i) => ({ url: `https://example.com/${i}.jpg`, position: i, isMain: i === 0 })),
    ...overrides,
  };
}

const perfectScores: ComponentScores = { seo: 90, title: 90, bullets: 90, description: 90, images: 90, conversion: 90, competition: 90 };

describe("generateListingIssues", () => {
  it("produces no issues when every component score is high", () => {
    const issues = generateListingIssues(product(), perfectScores);
    expect(issues).toHaveLength(0);
  });

  it("flags a CRITICAL image issue when there are no images", () => {
    const issues = generateListingIssues(product({ images: [] }), { ...perfectScores, images: 0 });
    const imageIssue = issues.find((i) => i.category === "IMAGES");
    expect(imageIssue?.severity).toBe("CRITICAL");
  });

  it("flags a CRITICAL bullet issue only when bullet points are entirely missing", () => {
    const issues = generateListingIssues(product({ bulletPoints: [] }), { ...perfectScores, bullets: 20 });
    const bulletIssue = issues.find((i) => i.category === "BULLETS");
    expect(bulletIssue?.severity).toBe("CRITICAL");
  });

  it("flags a MEDIUM bullet issue when bullets exist but score low", () => {
    const issues = generateListingIssues(product({ bulletPoints: ["short"] }), { ...perfectScores, bullets: 30 });
    const bulletIssue = issues.find((i) => i.category === "BULLETS");
    expect(bulletIssue?.severity).toBe("MEDIUM");
  });

  it("every generated issue includes evidence, a recommendation, and a source", () => {
    const issues = generateListingIssues(product({ images: [] }), { ...perfectScores, images: 0, title: 20 });
    for (const issue of issues) {
      expect(issue.recommendation.length).toBeGreaterThan(0);
      expect(issue.source.length).toBeGreaterThan(0);
      expect(issue.confidence).toBeGreaterThan(0);
    }
  });
});
