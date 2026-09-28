// Deterministic audit scoring. AI may assess individual components (see
// lib/providers/ai), but the final weighted score is always computed here,
// never invented by a model.

export const SCORE_WEIGHTS = {
  seo: 0.25,
  title: 0.1,
  bullets: 0.1,
  description: 0.05,
  images: 0.25,
  conversion: 0.15,
  competition: 0.1,
} as const;

export interface ComponentScores {
  seo: number;
  title: number;
  bullets: number;
  description: number;
  images: number;
  conversion: number;
  competition: number;
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function computeOverallScore(components: ComponentScores): number {
  const weighted =
    clampScore(components.seo) * SCORE_WEIGHTS.seo +
    clampScore(components.title) * SCORE_WEIGHTS.title +
    clampScore(components.bullets) * SCORE_WEIGHTS.bullets +
    clampScore(components.description) * SCORE_WEIGHTS.description +
    clampScore(components.images) * SCORE_WEIGHTS.images +
    clampScore(components.conversion) * SCORE_WEIGHTS.conversion +
    clampScore(components.competition) * SCORE_WEIGHTS.competition;

  return Math.round(weighted * 100) / 100;
}

export interface TitleInput {
  title: string;
  brandName: string;
}

export function scoreTitle({ title, brandName }: TitleInput): number {
  let score = 40;
  const len = title.length;
  if (len >= 80 && len <= 200) score += 25;
  else if (len >= 40) score += 12;

  const wordCount = title.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount >= 8) score += 15;
  else if (wordCount >= 5) score += 8;

  if (title.toLowerCase().includes(brandName.trim().toLowerCase())) score += 10;

  const hasNumbersOrSpecs = /\d/.test(title);
  if (hasNumbersOrSpecs) score += 10;

  return clampScore(score);
}

export function scoreBullets(bulletPoints: string[]): number {
  if (bulletPoints.length === 0) return 0;
  let score = 20;
  score += Math.min(bulletPoints.length, 5) * 10; // up to 50 for 5 bullets

  const avgLen = bulletPoints.reduce((s, b) => s + b.length, 0) / bulletPoints.length;
  if (avgLen >= 80 && avgLen <= 250) score += 20;
  else if (avgLen >= 40) score += 10;

  const hasBenefitLanguage = bulletPoints.some((b) => /benefit|help|easy|comfort|durable|quality/i.test(b));
  if (hasBenefitLanguage) score += 10;

  return clampScore(score);
}

export function scoreDescription(description: string | null): number {
  if (!description) return 0;
  let score = 20;
  if (description.length >= 400) score += 35;
  else if (description.length >= 150) score += 20;

  if (/\n|\r/.test(description) || description.split(". ").length >= 4) score += 15;

  const hasTrustSignals = /guarantee|warranty|certified|satisfaction/i.test(description);
  if (hasTrustSignals) score += 15;

  const hasCareOrUseInfo = /use|care|instructions|maintain/i.test(description);
  if (hasCareOrUseInfo) score += 15;

  return clampScore(score);
}

export interface ImageInput {
  imageCount: number;
  hasMainImage: boolean;
  infographicCount: number;
  lifestyleCount: number;
}

export function scoreImages({ imageCount, hasMainImage, infographicCount, lifestyleCount }: ImageInput): number {
  if (imageCount === 0) return 0;
  let score = 10;
  if (hasMainImage) score += 15;
  score += Math.min(imageCount, 7) * 6; // up to 42 for 7 images

  if (infographicCount >= 1) score += 15;
  if (lifestyleCount >= 1) score += 18;

  return clampScore(score);
}

export interface ConversionInput {
  rating: number | null;
  reviewCount: number | null;
  hasTrustSignalsInDescription: boolean;
  hasDifferentiationInBullets: boolean;
}

export function scoreConversion({
  rating,
  reviewCount,
  hasTrustSignalsInDescription,
  hasDifferentiationInBullets,
}: ConversionInput): number {
  let score = 15;
  if (rating !== null) {
    if (rating >= 4.5) score += 25;
    else if (rating >= 4.0) score += 18;
    else if (rating >= 3.5) score += 8;
  }
  if (reviewCount !== null) {
    if (reviewCount >= 500) score += 20;
    else if (reviewCount >= 100) score += 14;
    else if (reviewCount >= 20) score += 6;
  }
  if (hasTrustSignalsInDescription) score += 20;
  if (hasDifferentiationInBullets) score += 20;

  return clampScore(score);
}

export interface CompetitionInput {
  catalogSize: number;
  ratingVsBrandAverage: number | null; // this product's rating minus average brand rating
}

export function scoreCompetition({ catalogSize, ratingVsBrandAverage }: CompetitionInput): number {
  let score = 40;
  if (catalogSize >= 3) score += 20;
  else if (catalogSize >= 2) score += 10;

  if (ratingVsBrandAverage !== null) {
    if (ratingVsBrandAverage > 0) score += 25;
    else if (ratingVsBrandAverage === 0) score += 15;
    else score += 5;
  } else {
    score += 15;
  }

  return clampScore(score);
}
