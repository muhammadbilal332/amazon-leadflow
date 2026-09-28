import type { SupabaseClient } from "@supabase/supabase-js";
import type { SheetsExportRow } from "@/lib/providers/types";

export interface ExportBuildResult {
  brandName: string;
  brandId: string;
  rows: SheetsExportRow[];
}

/** Shared by both export destinations (Google Sheets, CSV) so the row
 * shape and the underlying query never drift between them. */
export async function buildExportRows(supabase: SupabaseClient, jobId: string): Promise<ExportBuildResult | null> {
  const { data: job, error: jobError } = await supabase
    .from("research_jobs")
    .select("id, brand_id, brands(name)")
    .eq("id", jobId)
    .single();
  if (jobError || !job) return null;

  const brandName = (job.brands as unknown as { name: string })?.name ?? "Unknown Brand";
  const brandId = job.brand_id as string;

  const { data: products } = await supabase
    .from("amazon_products")
    .select("*, listing_audits(overall_score, listing_issues(title, severity))")
    .eq("job_id", jobId);

  const { data: companies } = await supabase.from("companies").select("*, decision_makers(*, contacts(*))").eq("brand_id", brandId);

  const rows: SheetsExportRow[] = [];
  const company = companies?.[0];
  const people = company?.decision_makers ?? [];

  for (const product of products ?? []) {
    const audit = Array.isArray(product.listing_audits) ? product.listing_audits[0] : product.listing_audits;
    const issueTitles = ((audit?.listing_issues ?? []) as Array<{ title: string; severity: string }>)
      .filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH")
      .map((i) => i.title)
      .join("; ");

    if (people.length === 0) {
      rows.push(buildRow(brandName, product, audit, issueTitles, company, null));
    } else {
      for (const person of people) {
        rows.push(buildRow(brandName, product, audit, issueTitles, company, person));
      }
    }
  }

  return { brandName, brandId, rows };
}

function buildRow(
  brandName: string,
  product: Record<string, any>,
  audit: { overall_score?: number } | undefined,
  issueTitles: string,
  company: Record<string, any> | undefined,
  person: Record<string, any> | null,
): SheetsExportRow {
  const contact = person?.contacts?.[0] ?? person?.contacts ?? null;
  return {
    brand: brandName,
    amazonProduct: product.title,
    asin: product.asin,
    amazonUrl: product.url,
    classification: product.classification,
    confidence: Number(product.classification_confidence ?? 0),
    auditScore: Number(audit?.overall_score ?? 0),
    majorIssues: issueTitles || "none",
    company: company?.name ?? "",
    decisionMaker: person?.name ?? "",
    jobTitle: person?.job_title ?? "",
    linkedinUrl: person?.linkedin_url ?? "",
    email: contact?.email ?? "",
    emailStatus: contact?.email_status ?? "NOT_CHECKED",
    researchDate: new Date().toISOString().slice(0, 10),
  };
}

const CSV_HEADER = [
  "Brand",
  "Amazon Product",
  "ASIN",
  "Amazon URL",
  "Private Label Classification",
  "Confidence",
  "Audit Score",
  "Major Issues",
  "Company",
  "Decision Maker",
  "Job Title",
  "LinkedIn URL",
  "Email",
  "Email Status",
  "Research Date",
];

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function rowsToCsv(rows: SheetsExportRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.brand,
        r.amazonProduct,
        r.asin,
        r.amazonUrl,
        r.classification,
        r.confidence,
        r.auditScore,
        r.majorIssues,
        r.company,
        r.decisionMaker,
        r.jobTitle,
        r.linkedinUrl,
        r.email,
        r.emailStatus,
        r.researchDate,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
