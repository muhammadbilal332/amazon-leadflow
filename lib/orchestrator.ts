import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyBrand } from "@/lib/classification";
import { generateListingIssues } from "@/lib/issues";
import {
  computeOverallScore,
  scoreBullets,
  scoreCompetition,
  scoreConversion,
  scoreDescription,
  scoreImages,
  scoreTitle,
  type ComponentScores,
} from "@/lib/scoring";
import { isDemoMode } from "@/lib/providers/config";
import { callProviderChain } from "@/lib/providers/chain";
import {
  aiProviderChain,
  amazonProviderChain,
  emailProviderChain,
  hasRealAmazonProvider,
  hasRealEmailProvider,
  hasRealLeadProvider,
  leadProviderChain,
} from "@/lib/providers/registry";
import type {
  AiProvider,
  AmazonProvider,
  DiscoveredCompany,
  DiscoveredProduct,
  EmailProvider,
  LeadProvider,
  ProviderResult,
} from "@/lib/providers/types";
import { validateAiOutput } from "@/lib/validation/schemas";

interface RunJobParams {
  supabase: SupabaseClient;
  jobId: string;
  brandId: string;
  clientId: string;
  brandName: string;
  marketplace: string;
}

/** Accumulates low-priority log rows (provider_requests, research_sources)
 * in memory and writes them in a couple of bulk inserts instead of one
 * round trip per event. With a remote Postgres (Supabase is not
 * co-located with this process), each awaited round trip costs real wall
 * time — a job with 3 products and 3 decision makers previously issued
 * ~50 sequential requests; batching gets that down to ~15. */
class LogBuffer {
  private providerRequests: Record<string, unknown>[] = [];
  private researchSources: Record<string, unknown>[] = [];

  logProviderRequest(jobId: string, provider: string, operation: string, result: ProviderResult<unknown>) {
    this.providerRequests.push({
      job_id: jobId,
      provider,
      operation,
      status: result.status,
      duration_ms: result.durationMs,
      request_identifier: result.requestIdentifier ?? null,
    });
  }

  logResearchSource(jobId: string, entityType: string, entityId: string, provider: string, url: string | null, summary?: string | null) {
    this.researchSources.push({ job_id: jobId, entity_type: entityType, entity_id: entityId, provider, url, summary: summary ?? null });
  }

  async flush(supabase: SupabaseClient): Promise<void> {
    await Promise.all([
      this.providerRequests.length > 0
        ? supabase.from("provider_requests").insert(this.providerRequests)
        : Promise.resolve(),
      this.researchSources.length > 0
        ? supabase.from("research_sources").insert(this.researchSources)
        : Promise.resolve(),
    ]);
    this.providerRequests = [];
    this.researchSources = [];
  }
}

/** Runs the full research pipeline for one job, in-process, using the
 * provider fallback chains (real -> mock). This is what n8n's orchestrator
 * workflow calls over HTTP in production, and what the "Run now" button
 * calls directly in demo mode — same code path either way, so behavior
 * never diverges between the two triggers.
 *
 * Writes are batched (one upsert per table per job, not per row) to keep
 * the round-trip count to Supabase low regardless of how many products or
 * decision makers a job has. */
export async function runResearchJob(params: RunJobParams): Promise<void> {
  const { supabase, jobId, brandId, brandName, marketplace } = params;
  const log = new LogBuffer();

  const partialReasons: string[] = [];

  try {
    await updateJob(supabase, jobId, { status: "DISCOVERING", progress: 10, started_at: new Date().toISOString() });

    // Never fabricate Amazon product data (ASINs, prices, ratings, reviews,
    // etc.) just to make the UI look complete. Mock data is only used to
    // demo the rest of the pipeline when explicitly requested elsewhere —
    // here, if no real Amazon provider is configured, we skip the Amazon
    // product section entirely and continue with company/decision-maker
    // research rather than persist fake listings as if they were real.
    const amazonDataAvailable = hasRealAmazonProvider();
    let products: DiscoveredProduct[] = [];

    if (amazonDataAvailable) {
      const discovery = await callProviderChain(amazonProviderChain(), (p) => p.searchByBrand(brandName, marketplace));
      log.logProviderRequest(jobId, discovery.providerName, "searchByBrand", discovery.result);
      products = discovery.result.data ?? [];
      if (products.length === 0) {
        partialReasons.push("No Amazon products found for this brand.");
      }

      if (products.length > 0) {
        await updateJob(supabase, jobId, { status: "ANALYZING", progress: 30 });
        await runAmazonProductPipeline({ supabase, jobId, brandId, brandName, products, discoveryProviderName: discovery.providerName, log });
      }
    } else {
      partialReasons.push("Amazon data unavailable — authorization required (no SERPAPI_API_KEY configured).");
    }

    await updateJob(supabase, jobId, { status: "ENRICHING", progress: 55 });

    // Same rule as Amazon data above: never persist fabricated company
    // names, job titles, LinkedIn URLs, or emails. Without a real lead
    // provider (Hunter's free Domain Search, or paid Apollo), skip this
    // section and report it honestly instead of saving MockLeadProvider's
    // demo data as if it were a real person.
    const leadDataAvailable = hasRealLeadProvider();

    if (!leadDataAvailable) {
      partialReasons.push("Company and decision-maker data unavailable — authorization required (no HUNTER_API_KEY or APOLLO_API_KEY configured).");
    } else {
      const companyResult = await callProviderChain(leadProviderChain(), (p) => p.findCompany(brandName, null));
      log.logProviderRequest(jobId, companyResult.providerName, "findCompany", companyResult.result);

      let companyId: string | null = null;
      let discoveredCompany: DiscoveredCompany | null = null;
      if (companyResult.result.data) {
        discoveredCompany = companyResult.result.data;
        const { data: companyRow } = await supabase
          .from("companies")
          .upsert(
            {
              brand_id: brandId,
              name: discoveredCompany.name,
              domain: discoveredCompany.domain,
              website: discoveredCompany.website,
              description: discoveredCompany.description,
              employee_range: discoveredCompany.employeeRange,
              location: discoveredCompany.location,
              source: companyResult.providerName,
              // Additive fields (supabase/migrations/0004_lead_research_enrichment_fields.sql).
              // `?? null` because these are optional on DiscoveredCompany —
              // providers that don't research a field (Hunter/Apollo/mock)
              // simply never set it.
              linkedin_url: discoveredCompany.linkedinUrl ?? null,
              industry: discoveredCompany.industry ?? null,
              founded_year: discoveredCompany.foundedYear ?? null,
              contact_url: discoveredCompany.contactUrl ?? null,
              public_business_email: discoveredCompany.publicBusinessEmail ?? null,
              public_business_phone: discoveredCompany.publicBusinessPhone ?? null,
            },
            { onConflict: "brand_id,domain" },
          )
          .select("id")
          .single();
        companyId = companyRow?.id ?? null;
        if (companyId) {
          log.logResearchSource(jobId, "company", companyId, companyResult.providerName, discoveredCompany.website);
          // Providers that visited more than one public page (e.g. the
          // Playwright provider's homepage + About + Contact) can report
          // each one via the optional `sources` field, without a schema
          // change — research_sources is an insert-only log, so extra
          // rows for the same entity are fine.
          for (const url of discoveredCompany.sources ?? []) {
            if (url !== discoveredCompany.website) log.logResearchSource(jobId, "company", companyId, companyResult.providerName, url);
          }
        }
      } else {
        partialReasons.push("No company found for this brand's domain.");
      }

      if (companyId && discoveredCompany) {
        await updateJob(supabase, jobId, { progress: 70 });

        const peopleResult = await callProviderChain(leadProviderChain(), (p) => p.findDecisionMakers(discoveredCompany as DiscoveredCompany));
        log.logProviderRequest(jobId, peopleResult.providerName, "findDecisionMakers", peopleResult.result);

        const people = peopleResult.result.data ?? [];
        await updateJob(supabase, jobId, { status: "VERIFYING", progress: 80 });

        if (people.length > 0) {
          const { data: dmRows } = await supabase
            .from("decision_makers")
            .upsert(
              people.map((person) => ({
                company_id: companyId,
                name: person.name,
                job_title: person.jobTitle,
                role_category: person.roleCategory,
                linkedin_url: person.linkedinUrl,
                linkedin_status: person.linkedinStatus,
                location: person.location,
                source: peopleResult.providerName,
                confidence: person.confidence,
                headline: person.headline ?? null,
              })),
              { onConflict: "company_id,name,job_title" },
            )
            .select("id, name, job_title");

          if (dmRows) {
            const dmIdByKey = new Map(dmRows.map((r) => [`${r.name}::${r.job_title}`, r.id as string]));
            for (const person of people) {
              const dmId = dmIdByKey.get(`${person.name}::${person.jobTitle}`);
              if (dmId) {
                const evidence = person.evidence?.[0] ?? null;
                log.logResearchSource(jobId, "decision_maker", dmId, peopleResult.providerName, person.linkedinUrl, evidence);
                for (const url of person.sources ?? []) {
                  if (url !== person.linkedinUrl) log.logResearchSource(jobId, "decision_maker", dmId, peopleResult.providerName, url, evidence);
                }
              }
            }

            // Real email discovery/verification (Hunter) whenever
            // configured; without it, contacts are left NOT_CHECKED rather
            // than filled with a guessed address — see hasRealEmailProvider().
            if (!hasRealEmailProvider()) {
              partialReasons.push("Email discovery unavailable — authorization required (no HUNTER_API_KEY configured).");
            } else {
              // Email lookups are independent per person — run in parallel.
              const emailResults = await Promise.all(
                people.map((person) => callProviderChain(emailProviderChain(), (p) => p.findAndVerify(person.name, discoveredCompany?.domain ?? null))),
              );
              emailResults.forEach((r) => log.logProviderRequest(jobId, r.providerName, "findAndVerify", r.result));

              const contactRows = people
                .map((person, i) => {
                  const dmId = dmIdByKey.get(`${person.name}::${person.jobTitle}`);
                  if (!dmId) return null;
                  const emailResult = emailResults[i];
                  return {
                    decision_maker_id: dmId,
                    email: emailResult.result.data?.email ?? null,
                    email_status: emailResult.result.data?.status ?? "NOT_CHECKED",
                    email_verified_at: emailResult.result.data?.verifiedAt ?? null,
                    source: emailResult.providerName,
                  };
                })
                .filter((r): r is NonNullable<typeof r> => r !== null);

              if (contactRows.length > 0) {
                await supabase.from("contacts").upsert(contactRows, { onConflict: "decision_maker_id" });
              }
            }
          }
        } else {
          partialReasons.push("No decision makers found for this company.");
        }
      }
    }

    await log.flush(supabase);

    const partialReason = partialReasons.length > 0 ? partialReasons.join(" ") : null;
    await updateJob(supabase, jobId, {
      status: partialReason ? "PARTIAL" : "COMPLETED",
      progress: 100,
      error_message: partialReason,
      completed_at: new Date().toISOString(),
    });
  } catch (err) {
    await log.flush(supabase).catch(() => {});
    await logWorkflowError(supabase, jobId, "orchestrator", "run", err instanceof Error ? err.message : "unknown error");
    await updateJob(supabase, jobId, {
      status: "FAILED",
      error_message: err instanceof Error ? err.message : "unknown error",
      completed_at: new Date().toISOString(),
    });
  }
}

// --- helpers -----------------------------------------------------------

interface AmazonProductPipelineParams {
  supabase: SupabaseClient;
  jobId: string;
  brandId: string;
  brandName: string;
  products: DiscoveredProduct[];
  discoveryProviderName: string;
  log: LogBuffer;
}

/** Saves discovered (real) Amazon products and runs classification +
 * per-product scoring/audit/issues. Only ever called with products that
 * came from a real Amazon provider — see hasRealAmazonProvider() at the
 * call site in runResearchJob. */
async function runAmazonProductPipeline(params: AmazonProductPipelineParams): Promise<void> {
  const { supabase, jobId, brandId, brandName, products, discoveryProviderName, log } = params;

  const classification = classifyBrand(brandName, products);

  const { data: productRows, error: productError } = await supabase
    .from("amazon_products")
    .upsert(
      products.map((product) => ({
        brand_id: brandId,
        job_id: jobId,
        asin: product.asin,
        title: product.title,
        brand_label: product.brandLabel,
        seller_name: product.sellerName,
        seller_count: product.sellerCount,
        price: product.price,
        currency: product.currency,
        rating: product.rating,
        review_count: product.reviewCount,
        url: product.url,
        bullet_points: product.bulletPoints,
        description: product.description,
        classification: classification.classification,
        classification_confidence: classification.confidence,
        classification_evidence: classification.evidence,
      })),
      { onConflict: "brand_id,asin" },
    )
    .select("id, asin");

  if (productError || !productRows) {
    await logWorkflowError(supabase, jobId, "orchestrator", "save_products", productError?.message ?? "unknown insert error");
    return;
  }

  const productIdByAsin = new Map(productRows.map((r) => [r.asin, r.id as string]));
  const savedProducts = products
    .filter((p) => productIdByAsin.has(p.asin))
    .map((product) => ({ id: productIdByAsin.get(product.asin) as string, product }));

  for (const source of savedProducts) {
    log.logResearchSource(jobId, "amazon_product", source.id, discoveryProviderName, source.product.url);
  }

  const imageRows = savedProducts.flatMap(({ id, product }) =>
    product.images.map((img) => ({
      product_id: id,
      url: img.url,
      position: img.position,
      is_main: img.isMain,
      has_infographic: /infographic|feature/i.test(img.url) ? true : null,
      has_lifestyle: /lifestyle|in-use/i.test(img.url) ? true : null,
    })),
  );
  if (imageRows.length > 0) {
    await supabase.from("amazon_images").upsert(imageRows, { onConflict: "product_id,url" });
  }

  const avgBrandRating =
    products.reduce((s, p) => s + (p.rating ?? 0), 0) / Math.max(1, products.filter((p) => p.rating !== null).length);

  // Scoring + AI assessment is independent per product — run it in
  // parallel rather than one product at a time.
  const scored = await Promise.all(
    savedProducts.map(async ({ id: productId, product }) => {
      const components: ComponentScores = {
        title: scoreTitle({ title: product.title, brandName }),
        bullets: scoreBullets(product.bulletPoints),
        description: scoreDescription(product.description),
        images: scoreImages({
          imageCount: product.images.length,
          hasMainImage: product.images.some((i) => i.isMain),
          infographicCount: product.images.filter((i) => /infographic|feature/i.test(i.url)).length,
          lifestyleCount: product.images.filter((i) => /lifestyle|in-use/i.test(i.url)).length,
        }),
        conversion: scoreConversion({
          rating: product.rating,
          reviewCount: product.reviewCount,
          hasTrustSignalsInDescription: /guarantee|warranty|certified/i.test(product.description ?? ""),
          hasDifferentiationInBullets: product.bulletPoints.some((b) => /unique|only|exclusive|patented/i.test(b)),
        }),
        competition: scoreCompetition({
          catalogSize: products.length,
          ratingVsBrandAverage: product.rating !== null ? Math.round((product.rating - avgBrandRating) * 100) / 100 : null,
        }),
        seo: 0,
      };
      // SEO is a composite of the content-bearing components, not fully independent.
      components.seo = Math.round((components.title * 0.4 + components.bullets * 0.35 + components.description * 0.25) * 100) / 100;

      const overall = computeOverallScore(components);

      const aiAssessment = await callProviderChain(aiProviderChain(), (p) =>
        p.analyze({
          kind: "listing_component_assessment",
          input: { title: product.title, bulletPoints: product.bulletPoints, description: product.description },
        }),
      );

      return { productId, product, components, overall, aiAssessment };
    }),
  );

  const aiAnalysesRows = scored
    .filter((s) => s.aiAssessment.result.data)
    .map((s) => {
      const { valid } = validateAiOutput("listing_component_assessment", s.aiAssessment.result.data);
      return {
        job_id: jobId,
        target_type: "amazon_product",
        target_id: s.productId,
        provider: s.aiAssessment.providerName,
        prompt_kind: "listing_component_assessment",
        output: s.aiAssessment.result.data,
        valid,
      };
    });
  if (aiAnalysesRows.length > 0) {
    await supabase.from("ai_analyses").insert(aiAnalysesRows);
  }

  const { data: auditRows } = await supabase
    .from("listing_audits")
    .upsert(
      scored.map((s) => ({
        product_id: s.productId,
        overall_score: s.overall,
        seo_score: s.components.seo,
        title_score: s.components.title,
        bullet_score: s.components.bullets,
        description_score: s.components.description,
        image_score: s.components.images,
        conversion_score: s.components.conversion,
        competition_score: s.components.competition,
        ai_summary: typeof s.aiAssessment.result.data?.conversionAssessment === "object" ? JSON.stringify(s.aiAssessment.result.data) : null,
      })),
      { onConflict: "product_id" },
    )
    .select("id, product_id");

  if (auditRows) {
    const auditIdByProductId = new Map(auditRows.map((r) => [r.product_id as string, r.id as string]));
    const issueRows = scored.flatMap((s) => {
      const auditId = auditIdByProductId.get(s.productId);
      if (!auditId) return [];
      return generateListingIssues(s.product, s.components).map((issue) => ({ audit_id: auditId, ...issue }));
    });
    if (issueRows.length > 0) {
      await supabase.from("listing_issues").upsert(issueRows, { onConflict: "audit_id,category" });
    }
  }
}

async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase.from("research_jobs").update(patch).eq("id", jobId);
}

async function logWorkflowError(
  supabase: SupabaseClient,
  jobId: string,
  workflow: string,
  step: string,
  message: string,
): Promise<void> {
  await supabase.from("workflow_errors").insert({ job_id: jobId, workflow, step, message });
}

export function demoModeActive(): boolean {
  return isDemoMode();
}

// Re-exported so route handlers can type provider chains without importing
// from lib/providers directly.
export type { AmazonProvider, LeadProvider, EmailProvider, AiProvider };
