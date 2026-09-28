import { describe, expect, it } from "vitest";
import {
  computeOverallScore,
  scoreBullets,
  scoreCompetition,
  scoreConversion,
  scoreDescription,
  scoreImages,
  scoreTitle,
  SCORE_WEIGHTS,
} from "@/lib/scoring";

describe("SCORE_WEIGHTS", () => {
  it("sums to 1.0", () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.round(total * 100) / 100).toBe(1);
  });
});

describe("computeOverallScore", () => {
  it("returns 100 when every component is 100", () => {
    const score = computeOverallScore({
      seo: 100,
      title: 100,
      bullets: 100,
      description: 100,
      images: 100,
      conversion: 100,
      competition: 100,
    });
    expect(score).toBe(100);
  });

  it("returns 0 when every component is 0", () => {
    const score = computeOverallScore({ seo: 0, title: 0, bullets: 0, description: 0, images: 0, conversion: 0, competition: 0 });
    expect(score).toBe(0);
  });

  it("clamps out-of-range component scores instead of over/under-weighting", () => {
    const score = computeOverallScore({ seo: 150, title: -20, bullets: 50, description: 50, images: 50, conversion: 50, competition: 50 });
    const clampedEquivalent = computeOverallScore({ seo: 100, title: 0, bullets: 50, description: 50, images: 50, conversion: 50, competition: 50 });
    expect(score).toBe(clampedEquivalent);
  });

  it("weights images and SEO most heavily", () => {
    const highImages = computeOverallScore({ seo: 0, title: 0, bullets: 0, description: 0, images: 100, conversion: 0, competition: 0 });
    const highDescription = computeOverallScore({ seo: 0, title: 0, bullets: 0, description: 100, images: 0, conversion: 0, competition: 0 });
    expect(highImages).toBeGreaterThan(highDescription);
  });
});

describe("scoreTitle", () => {
  it("scores an empty title low", () => {
    expect(scoreTitle({ title: "", brandName: "Acme" })).toBeLessThan(50);
  });

  it("rewards a well-formed keyword-rich title containing the brand name", () => {
    const score = scoreTitle({
      title: "Acme Premium Stainless Steel Water Bottle 32oz - Leakproof, Insulated, BPA-Free",
      brandName: "Acme",
    });
    expect(score).toBeGreaterThan(70);
  });
});

describe("scoreBullets", () => {
  it("returns 0 for no bullet points", () => {
    expect(scoreBullets([])).toBe(0);
  });

  it("rewards 5 benefit-driven bullets over 1 short bullet", () => {
    const many = scoreBullets([
      "DURABLE AND COMFORTABLE - built to last through daily use",
      "EASY TO CLEAN - dishwasher safe for effortless maintenance",
      "GREAT BENEFIT - keeps drinks cold for 24 hours",
      "PORTABLE DESIGN - fits most cup holders",
      "SATISFACTION GUARANTEE - backed by our quality promise",
    ]);
    const few = scoreBullets(["short"]);
    expect(many).toBeGreaterThan(few);
  });
});

describe("scoreDescription", () => {
  it("returns 0 for a null description", () => {
    expect(scoreDescription(null)).toBe(0);
  });

  it("rewards long structured descriptions with trust signals", () => {
    const long = scoreDescription(
      "This product is built for everyday use. ".repeat(15) + " It comes with a satisfaction guarantee and certified materials.",
    );
    expect(long).toBeGreaterThan(70);
  });
});

describe("scoreImages", () => {
  it("returns 0 when there are no images", () => {
    expect(scoreImages({ imageCount: 0, hasMainImage: false, infographicCount: 0, lifestyleCount: 0 })).toBe(0);
  });

  it("rewards a full gallery with main, infographic, and lifestyle images", () => {
    const score = scoreImages({ imageCount: 7, hasMainImage: true, infographicCount: 2, lifestyleCount: 2 });
    expect(score).toBeGreaterThan(80);
  });
});

describe("scoreConversion", () => {
  it("rewards high rating, high review count, and trust/differentiation signals", () => {
    const score = scoreConversion({
      rating: 4.8,
      reviewCount: 1000,
      hasTrustSignalsInDescription: true,
      hasDifferentiationInBullets: true,
    });
    expect(score).toBe(100);
  });

  it("scores conservatively with no data available", () => {
    const score = scoreConversion({ rating: null, reviewCount: null, hasTrustSignalsInDescription: false, hasDifferentiationInBullets: false });
    expect(score).toBeLessThan(30);
  });
});

describe("scoreCompetition", () => {
  it("rewards a larger catalog and above-average rating", () => {
    const score = scoreCompetition({ catalogSize: 5, ratingVsBrandAverage: 0.5 });
    expect(score).toBe(85);
  });
});
