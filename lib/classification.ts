import type { PrivateLabelClassification } from "@/types/database";
import type { DiscoveredProduct } from "@/lib/providers/types";

export interface ClassificationEvidence {
  brandConsistency: boolean;
  singleSellerDominant: boolean;
  sellerCountAcrossCatalog: number;
  catalogSize: number;
  brandNameMatchesSellerName: boolean;
  repeatedBrandedProducts: boolean;
}

export interface ClassificationResult {
  classification: PrivateLabelClassification;
  confidence: number;
  evidence: ClassificationEvidence;
}

/** Deterministic private-label heuristic. This is intentionally rule-based
 * (not AI-guessed): the same inputs always produce the same output, and
 * every field in `evidence` is a fact we can point to, not an inference. */
export function classifyBrand(brandName: string, products: DiscoveredProduct[]): ClassificationResult {
  const catalogSize = products.length;

  if (catalogSize === 0) {
    return {
      classification: "UNKNOWN",
      confidence: 0,
      evidence: {
        brandConsistency: false,
        singleSellerDominant: false,
        sellerCountAcrossCatalog: 0,
        catalogSize: 0,
        brandNameMatchesSellerName: false,
        repeatedBrandedProducts: false,
      },
    };
  }

  const normalizedBrand = brandName.trim().toLowerCase();
  const brandLabelMatches = products.filter(
    (p) => (p.brandLabel ?? "").trim().toLowerCase() === normalizedBrand,
  ).length;
  const brandConsistency = brandLabelMatches / catalogSize >= 0.8;

  const avgSellerCount =
    products.reduce((sum, p) => sum + (p.sellerCount ?? 1), 0) / catalogSize;
  const singleSellerDominant = avgSellerCount <= 1.3;

  const sellerNameMatches = products.filter(
    (p) => (p.sellerName ?? "").trim().toLowerCase().includes(normalizedBrand),
  ).length;
  const brandNameMatchesSellerName = sellerNameMatches / catalogSize >= 0.5;

  const repeatedBrandedProducts = catalogSize >= 3 && brandConsistency;

  const evidence: ClassificationEvidence = {
    brandConsistency,
    singleSellerDominant,
    sellerCountAcrossCatalog: Math.round(avgSellerCount * 100) / 100,
    catalogSize,
    brandNameMatchesSellerName,
    repeatedBrandedProducts,
  };

  // Score positive signals for "private label", each worth equal weight.
  const positiveSignals = [
    brandConsistency,
    singleSellerDominant,
    brandNameMatchesSellerName,
    repeatedBrandedProducts,
  ].filter(Boolean).length;

  if (!singleSellerDominant && avgSellerCount >= 3) {
    return { classification: "LIKELY_RESELLER", confidence: 0.75, evidence };
  }
  if (!singleSellerDominant && avgSellerCount >= 2) {
    return { classification: "WHOLESALE", confidence: 0.55, evidence };
  }
  if (positiveSignals >= 3) {
    return { classification: "LIKELY_PRIVATE_LABEL", confidence: 0.85, evidence };
  }
  if (positiveSignals === 2) {
    return { classification: "POSSIBLE_PRIVATE_LABEL", confidence: 0.6, evidence };
  }
  return { classification: "UNKNOWN", confidence: 0.3, evidence };
}
