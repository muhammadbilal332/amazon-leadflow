import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClassificationBadge, EmailStatusBadge, JobStatusBadge, SeverityBadge } from "@/components/status-badges";
import { ScoreRing } from "@/components/score-ring";
import { Progress } from "@/components/ui/progress";
import { JobActions } from "@/components/job-actions";
import { JobPoller } from "@/components/job-poller";
import { formatDateTime } from "@/lib/utils";

const TERMINAL_STATUSES = ["COMPLETED", "PARTIAL", "FAILED"];

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: job } = await supabase.from("research_jobs").select("*, brands(id, name, marketplace)").eq("id", params.id).single();
  if (!job) notFound();

  const brand = job.brands as unknown as { id: string; name: string; marketplace: string };

  const [{ data: products }, { data: companies }, { data: sources }, { data: errors }] = await Promise.all([
    supabase
      .from("amazon_products")
      .select("*, listing_audits(*, listing_issues(*))")
      .eq("job_id", params.id),
    supabase.from("companies").select("*, decision_makers(*, contacts(*))").eq("brand_id", brand.id),
    supabase.from("research_sources").select("*").eq("job_id", params.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("workflow_errors").select("*").eq("job_id", params.id).order("created_at", { ascending: false }),
  ]);

  const company = companies?.[0];

  return (
    <div className="min-h-screen">
      <Nav />
      <JobPoller status={job.status} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href={`/brands/${brand.id}`} className="text-sm text-muted-foreground hover:underline">
              {brand.name}
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Research Job</h1>
          </div>
          <div className="flex items-center gap-3">
            <JobStatusBadge status={job.status} />
            <span className="text-sm text-muted-foreground">{formatDateTime(job.created_at)}</span>
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 pt-6">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                Progress
                {!TERMINAL_STATUSES.includes(job.status) && (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </span>
                )}
              </span>
              <span>{job.progress}%</span>
            </div>
            <Progress value={job.progress} />
            {!TERMINAL_STATUSES.includes(job.status) && (
              <p className="text-xs text-muted-foreground">Updating automatically — no need to refresh.</p>
            )}
            {job.error_message && (
              <p className={`text-sm ${job.error_message.startsWith("Amazon data unavailable") ? "text-amber-600 dark:text-amber-400" : "text-destructive"}`}>
                {job.error_message}
              </p>
            )}
            <JobActions jobId={job.id} />
          </CardContent>
        </Card>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Products & Listing Audits</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {products && products.length > 0 ? (
              products.map((product) => {
                const audit = Array.isArray(product.listing_audits) ? product.listing_audits[0] : product.listing_audits;
                const issues = audit?.listing_issues ?? [];
                return (
                  <div key={product.id} className="rounded-lg border border-border p-4">
                    <div className="flex items-start gap-4">
                      {audit && <ScoreRing score={Number(audit.overall_score)} />}
                      <div className="flex-1">
                        <a href={product.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                          {product.title}
                        </a>
                        <p className="text-xs text-muted-foreground">
                          ASIN {product.asin} · {product.review_count ?? 0} reviews · {product.rating ?? "n/a"}★
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <ClassificationBadge classification={product.classification} />
                          <span className="text-xs text-muted-foreground">
                            confidence {Math.round(Number(product.classification_confidence) * 100)}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {audit && (
                      <div className="mt-4 grid grid-cols-3 gap-2 text-xs sm:grid-cols-7">
                        {[
                          ["SEO", audit.seo_score],
                          ["Title", audit.title_score],
                          ["Bullets", audit.bullet_score],
                          ["Description", audit.description_score],
                          ["Images", audit.image_score],
                          ["Conversion", audit.conversion_score],
                          ["Competition", audit.competition_score],
                        ].map(([label, value]) => (
                          <div key={label as string} className="rounded-md bg-muted p-2 text-center">
                            <p className="font-medium">{Math.round(Number(value))}</p>
                            <p className="text-muted-foreground">{label}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {issues.length > 0 && (
                      <div className="mt-4 flex flex-col gap-2">
                        {issues.map((issue: Record<string, any>) => (
                          <div key={issue.id} className="flex items-start gap-3 rounded-md border border-border p-3 text-sm">
                            <SeverityBadge severity={issue.severity} />
                            <div>
                              <p className="font-medium">{issue.title}</p>
                              <p className="text-muted-foreground">{issue.description}</p>
                              <p className="mt-1 text-xs text-primary">{issue.recommendation}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            ) : job.error_message?.startsWith("Amazon data unavailable") ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                <p className="font-medium">Amazon data unavailable — authorization required</p>
                <p className="mt-1 text-xs opacity-90">
                  Configure <code className="font-mono">SERPAPI_API_KEY</code> in your environment to enable real Amazon product discovery.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {TERMINAL_STATUSES.includes(job.status)
                  ? "No products discovered for this job."
                  : "Discovering products…"}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Company & Decision Makers</CardTitle>
            </CardHeader>
            <CardContent>
              {company ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="font-medium">{company.name}</p>
                    <p className="text-sm text-muted-foreground">{company.description}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {company.industry && <span>{company.industry}</span>}
                      {company.founded_year && <span>Founded {company.founded_year}</span>}
                      {company.public_business_email && <span>{company.public_business_email}</span>}
                      {company.public_business_phone && <span>{company.public_business_phone}</span>}
                      {company.contact_url && (
                        <a href={company.contact_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          Contact page
                        </a>
                      )}
                      {company.linkedin_url && (
                        <a href={company.linkedin_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                          LinkedIn company page
                        </a>
                      )}
                    </div>
                  </div>
                  {((company.decision_makers as unknown as Array<Record<string, any>>) ?? []).map((dm) => {
                    const contact = Array.isArray(dm.contacts) ? dm.contacts[0] : dm.contacts;
                    return (
                      <div key={dm.id} className="rounded-md border border-border p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{dm.name}</p>
                          {contact?.email_status && <EmailStatusBadge status={contact.email_status} />}
                        </div>
                        <p className="text-xs text-muted-foreground">{dm.job_title}</p>
                        {dm.headline && <p className="text-xs italic text-muted-foreground">{dm.headline}</p>}
                        <p className="mt-1 text-xs">
                          {dm.linkedin_status === "FOUND" && dm.linkedin_url ? (
                            <a href={dm.linkedin_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                              LinkedIn profile
                            </a>
                          ) : (
                            "LinkedIn: not found"
                          )}
                        </p>
                        {contact?.email && <p className="text-xs">{contact.email}</p>}
                      </div>
                    );
                  })}
                </div>
              ) : job.error_message?.includes("Company and decision-maker data unavailable") ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  <p className="font-medium">Company data unavailable — authorization required</p>
                  <p className="mt-1 text-xs opacity-90">
                    Configure <code className="font-mono">HUNTER_API_KEY</code> (free tier) to enable real company and decision-maker discovery.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No company research found for this job.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sources & Errors</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <p className="mb-2 text-sm font-medium">Research sources</p>
                <div className="flex flex-col gap-1">
                  {sources && sources.length > 0 ? (
                    sources.map((source) => (
                      <p key={source.id} className="text-xs text-muted-foreground">
                        [{source.provider}] {source.entity_type} — {source.url ?? "no url"}
                        {source.summary && <span className="italic"> ({source.summary})</span>}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">No sources logged.</p>
                  )}
                </div>
              </div>
              {errors && errors.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-destructive">Workflow errors</p>
                  <div className="flex flex-col gap-1">
                    {errors.map((err) => (
                      <p key={err.id} className="text-xs text-destructive">
                        [{err.workflow}/{err.step}] {err.message}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
