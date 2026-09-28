import type { IssueSeverity } from "@/types/database";
import type { DiscoveredProduct } from "@/lib/providers/types";
import type { ComponentScores } from "@/lib/scoring";

export interface GeneratedIssue {
  category: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  evidence: string | null;
  recommendation: string;
  source: string;
  confidence: number;
}

/** Every issue here is derived from a concrete, checkable fact about the
 * product (component score below a threshold, or a missing field) — never a
 * generic filler item. */
export function generateListingIssues(product: DiscoveredProduct, scores: ComponentScores): GeneratedIssue[] {
  const issues: GeneratedIssue[] = [];

  if (scores.images === 0) {
    issues.push({
      category: "IMAGES",
      severity: "CRITICAL",
      title: "No product images found",
      description: "This listing has no images on record, which severely limits buyer trust and conversion.",
      evidence: "image count = 0",
      recommendation: "Upload a minimum of 6 images: a clean main image, infographic, lifestyle, and dimension/scale shots.",
      source: "deterministic-audit",
      confidence: 0.95,
    });
  } else if (scores.images < 50) {
    const count = product.images.length;
    issues.push({
      category: "IMAGES",
      severity: scores.images < 30 ? "HIGH" : "MEDIUM",
      title: "Image gallery is underdeveloped",
      description: `Only ${count} image(s) are present, with limited infographic or lifestyle coverage.`,
      evidence: `image count = ${count}`,
      recommendation: "Add infographic slides highlighting key specs and at least one lifestyle/in-use image.",
      source: "deterministic-audit",
      confidence: 0.8,
    });
  }

  if (scores.title < 50) {
    issues.push({
      category: "TITLE",
      severity: scores.title < 30 ? "HIGH" : "MEDIUM",
      title: "Title is not optimized for search or clarity",
      description: `Title scored ${scores.title}/100 on length, keyword density, and brand placement.`,
      evidence: `title = "${product.title}"`,
      recommendation: "Rewrite the title to front-load primary keywords, include the brand name, and stay within 150-200 characters.",
      source: "deterministic-audit",
      confidence: 0.75,
    });
  }

  if (scores.bullets < 50) {
    issues.push({
      category: "BULLETS",
      severity: product.bulletPoints.length === 0 ? "CRITICAL" : "MEDIUM",
      title: product.bulletPoints.length === 0 ? "No bullet points found" : "Bullet points lack benefit-driven language",
      description: `Bullet points scored ${scores.bullets}/100. ${product.bulletPoints.length} bullet(s) on record.`,
      evidence: product.bulletPoints.join(" | ") || "no bullet points",
      recommendation: "Use all 5 bullet slots, lead each with a capitalized benefit, and address common buyer objections.",
      source: "deterministic-audit",
      confidence: 0.75,
    });
  }

  if (scores.description < 50) {
    issues.push({
      category: "DESCRIPTION",
      severity: !product.description ? "HIGH" : "MEDIUM",
      title: !product.description ? "No product description found" : "Description is thin or missing structure",
      description: `Description scored ${scores.description}/100 on length, structure, and trust signals.`,
      evidence: product.description ? `${product.description.slice(0, 140)}...` : "no description",
      recommendation: "Expand the description to 400+ characters, use line breaks, and mention warranty/guarantee details.",
      source: "deterministic-audit",
      confidence: 0.7,
    });
  }

  if (scores.conversion < 50) {
    issues.push({
      category: "CONVERSION",
      severity: "MEDIUM",
      title: "Weak conversion signals",
      description: `Conversion scored ${scores.conversion}/100 based on rating, review volume, and trust/differentiation language.`,
      evidence: `rating=${product.rating ?? "n/a"}, reviews=${product.reviewCount ?? 0}`,
      recommendation: "Highlight differentiation vs. competitors and add explicit trust signals (guarantee, certifications).",
      source: "deterministic-audit",
      confidence: 0.65,
    });
  }

  if (scores.seo < 50) {
    issues.push({
      category: "SEO",
      severity: "MEDIUM",
      title: "Keyword coverage appears limited",
      description: `SEO component scored ${scores.seo}/100 across title, bullets, and description.`,
      evidence: "derived from title/bullet/description component scores",
      recommendation: "Run a keyword gap analysis against top competitors and weave missing terms into title/bullets naturally.",
      source: "deterministic-audit",
      confidence: 0.6,
    });
  }

  return issues;
}
