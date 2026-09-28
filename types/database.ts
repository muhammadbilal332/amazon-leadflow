// Hand-written types mirroring supabase/migrations/0001_init.sql.
// Regenerate with `supabase gen types typescript` once a live project exists.

export type JobStatus =
  | "PENDING"
  | "RUNNING"
  | "DISCOVERING"
  | "ANALYZING"
  | "ENRICHING"
  | "VERIFYING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED";

export type PrivateLabelClassification =
  | "LIKELY_PRIVATE_LABEL"
  | "POSSIBLE_PRIVATE_LABEL"
  | "LIKELY_RESELLER"
  | "WHOLESALE"
  | "UNKNOWN";

export type IssueSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type EmailStatus =
  | "VALID"
  | "INVALID"
  | "ACCEPT_ALL"
  | "UNKNOWN"
  | "NOT_CHECKED";

export type LinkedinStatus = "FOUND" | "NOT_FOUND";

export type ProviderStatus =
  | "CONFIGURED"
  | "NOT_CONFIGURED"
  | "FREE_QUOTA_UNKNOWN"
  | "FREE_QUOTA_EXHAUSTED"
  | "DISABLED"
  | "ERROR";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  client_id: string | null;
  created_at: string;
}

export interface Client {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
}

export interface Brand {
  id: string;
  client_id: string;
  name: string;
  normalized_name: string;
  marketplace: string;
  website: string | null;
  created_at: string;
}

export interface ResearchJob {
  id: string;
  brand_id: string;
  client_id: string;
  status: JobStatus;
  progress: number;
  error_message: string | null;
  demo_mode: boolean;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface AmazonProduct {
  id: string;
  brand_id: string;
  job_id: string;
  asin: string;
  title: string;
  brand_label: string | null;
  seller_name: string | null;
  seller_count: number | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  review_count: number | null;
  url: string;
  bullet_points: string[];
  description: string | null;
  classification: PrivateLabelClassification;
  classification_confidence: number;
  classification_evidence: Record<string, unknown>;
  created_at: string;
}

export interface AmazonImage {
  id: string;
  product_id: string;
  url: string;
  position: number;
  is_main: boolean;
  has_infographic: boolean | null;
  has_lifestyle: boolean | null;
  created_at: string;
}

export interface ListingAudit {
  id: string;
  product_id: string;
  overall_score: number;
  seo_score: number;
  title_score: number;
  bullet_score: number;
  description_score: number;
  image_score: number;
  conversion_score: number;
  competition_score: number;
  ai_summary: string | null;
  created_at: string;
}

export interface ListingIssue {
  id: string;
  audit_id: string;
  category: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  evidence: string | null;
  recommendation: string;
  source: string;
  confidence: number;
  created_at: string;
}

export interface Company {
  id: string;
  brand_id: string;
  name: string;
  domain: string | null;
  website: string | null;
  description: string | null;
  employee_range: string | null;
  location: string | null;
  source: string;
  created_at: string;
  // Additive (0004_lead_research_enrichment_fields.sql). linkedin_url is
  // never populated by PlaywrightLeadProvider (no LinkedIn automation) --
  // only by a provider with a licensed LinkedIn data source (Hunter/Apollo)
  // or a future replacement.
  linkedin_url: string | null;
  industry: string | null;
  founded_year: string | null;
  contact_url: string | null;
  public_business_email: string | null;
  public_business_phone: string | null;
}

export interface DecisionMaker {
  id: string;
  company_id: string;
  name: string;
  job_title: string;
  role_category: string;
  linkedin_url: string | null;
  linkedin_status: LinkedinStatus;
  location: string | null;
  source: string;
  confidence: number;
  created_at: string;
  // Additive (0004_lead_research_enrichment_fields.sql).
  headline: string | null;
}

export interface Contact {
  id: string;
  decision_maker_id: string;
  email: string | null;
  email_status: EmailStatus;
  email_verified_at: string | null;
  phone: string | null;
  source: string;
  created_at: string;
}

export interface ResearchSource {
  id: string;
  job_id: string;
  entity_type: string;
  entity_id: string;
  provider: string;
  url: string | null;
  summary: string | null;
  created_at: string;
}

export interface ProviderRequest {
  id: string;
  job_id: string | null;
  provider: string;
  operation: string;
  status: "SUCCESS" | "ERROR" | "SKIPPED_QUOTA" | "SKIPPED_DISABLED";
  duration_ms: number | null;
  request_identifier: string | null;
  created_at: string;
}

export interface AiAnalysis {
  id: string;
  job_id: string;
  target_type: string;
  target_id: string;
  provider: string;
  prompt_kind: string;
  output: Record<string, unknown>;
  valid: boolean;
  created_at: string;
}

export interface WorkflowError {
  id: string;
  job_id: string | null;
  workflow: string;
  step: string;
  message: string;
  created_at: string;
}

export interface ExportRecord {
  id: string;
  job_id: string;
  brand_id: string;
  destination: string;
  status: "SUCCESS" | "ERROR" | "NOT_CONFIGURED";
  spreadsheet_url: string | null;
  created_at: string;
}
