import type { EmailStatus, ProviderStatus } from "@/types/database";

// Every external integration implements one of these interfaces, always with
// a mock counterpart. Nothing in the application may depend on a concrete
// provider — only on these contracts. See docs/PROVIDERS.md.

export interface ProviderResult<T> {
  status: "SUCCESS" | "ERROR" | "SKIPPED_QUOTA" | "SKIPPED_DISABLED";
  data: T | null;
  errorMessage?: string;
  durationMs: number;
  requestIdentifier?: string;
}

export interface DiscoveredProduct {
  asin: string;
  title: string;
  brandLabel: string | null;
  sellerName: string | null;
  sellerCount: number | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  reviewCount: number | null;
  url: string;
  bulletPoints: string[];
  description: string | null;
  images: { url: string; position: number; isMain: boolean }[];
}

export interface AmazonProvider {
  readonly name: string;
  status(): ProviderStatus;
  searchByBrand(brand: string, marketplace: string): Promise<ProviderResult<DiscoveredProduct[]>>;
}

export interface DiscoveredCompany {
  name: string;
  domain: string | null;
  website: string | null;
  description: string | null;
  /** AKA "company size" in some provider docs — kept as employeeRange since
   * that's the existing, already-persisted field name. */
  employeeRange: string | null;
  /** AKA "headquarters" — kept as location since that's the existing,
   * already-persisted field name. */
  location: string | null;
  /** Optional, additive fields (supabase/migrations/0004_lead_research_enrichment_fields.sql).
   * Every existing provider (Mock/Hunter/Apollo) simply doesn't set them —
   * `undefined` there is not "checked and absent", just "this provider
   * doesn't research this field". Never fabricated: null/undefined means
   * genuinely not established, not "assumed absent". */
  /** Never populated by PlaywrightLeadProvider — no LinkedIn automation
   * (see docs/PROVIDERS.md). Only a provider with a licensed LinkedIn data
   * source (Hunter/Apollo) or a future replacement sets this. */
  linkedinUrl?: string | null;
  industry?: string | null;
  foundedYear?: string | null;
  contactUrl?: string | null;
  publicBusinessEmail?: string | null;
  publicBusinessPhone?: string | null;
  /** Every public page a provider actually pulled data from (its own
   * homepage/About/Contact pages, etc.). When present, the orchestrator
   * logs each URL to research_sources alongside the existing single-URL
   * logging. */
  sources?: string[];
}

export interface DiscoveredDecisionMaker {
  name: string;
  jobTitle: string;
  roleCategory: string;
  linkedinUrl: string | null;
  linkedinStatus: "FOUND" | "NOT_FOUND";
  location: string | null;
  confidence: number;
  /** Optional, additive (supabase/migrations/0004_lead_research_enrichment_fields.sql):
   * a professional headline/tagline found next to the person's name, if any. */
  headline?: string | null;
  /** Optional: see DiscoveredCompany.sources. */
  sources?: string[];
  /** Optional: the literal matched text a person/title/role was extracted
   * from — lets a reviewer see exactly why this candidate was returned,
   * without inventing a separate evidence schema (research_sources already
   * carries the provider+URL half of this; this carries the "what text
   * justified it" half). */
  evidence?: string[];
}

/** A mapped/derived view over DiscoveredDecisionMaker, produced by
 * lib/providers/people/leadership-discovery.ts — not a competing schema,
 * not persisted on its own. See that file for the exact mapping and the
 * confidence-cutoff / verified rules. */
export interface LeadershipRecord {
  fullName: string;
  title: string;
  company: string;
  linkedinUrl: string | null;
  sourceUrl: string | null;
  sourceType: "company_website" | "licensed_provider" | "mock";
  confidence: number;
  verified: boolean;
}

export interface LeadProvider {
  readonly name: string;
  status(): ProviderStatus;
  findCompany(brand: string, website: string | null): Promise<ProviderResult<DiscoveredCompany | null>>;
  findDecisionMakers(company: DiscoveredCompany): Promise<ProviderResult<DiscoveredDecisionMaker[]>>;
}

export interface EmailGuess {
  email: string;
  status: EmailStatus;
  verifiedAt: string | null;
}

export interface EmailProvider {
  readonly name: string;
  status(): ProviderStatus;
  findAndVerify(
    fullName: string,
    domain: string | null,
  ): Promise<ProviderResult<EmailGuess | null>>;
}

export interface AiJsonRequest {
  kind: string;
  input: Record<string, unknown>;
}

export interface AiProvider {
  readonly name: string;
  status(): ProviderStatus;
  analyze(request: AiJsonRequest): Promise<ProviderResult<Record<string, unknown>>>;
}

export interface SheetsExportRow {
  brand: string;
  amazonProduct: string;
  asin: string;
  amazonUrl: string;
  classification: string;
  confidence: number;
  auditScore: number;
  majorIssues: string;
  company: string;
  decisionMaker: string;
  jobTitle: string;
  linkedinUrl: string;
  email: string;
  emailStatus: string;
  researchDate: string;
}

export interface SheetsProvider {
  readonly name: string;
  status(): ProviderStatus;
  exportRows(
    title: string,
    rows: SheetsExportRow[],
  ): Promise<ProviderResult<{ spreadsheetUrl: string }>>;
}
