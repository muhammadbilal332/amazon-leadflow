import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClassificationBadge, JobStatusBadge } from "@/components/status-badges";
import { ScoreRing } from "@/components/score-ring";
import { formatDate } from "@/lib/utils";

export default async function BrandDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const { data: brand } = await supabase.from("brands").select("*").eq("id", params.id).single();
  if (!brand) notFound();

  const [{ data: products }, { data: jobs }, { data: companies }] = await Promise.all([
    supabase
      .from("amazon_products")
      .select("*, listing_audits(overall_score)")
      .eq("brand_id", params.id)
      .order("created_at", { ascending: false }),
    supabase.from("research_jobs").select("*").eq("brand_id", params.id).order("created_at", { ascending: false }),
    supabase.from("companies").select("*, decision_makers(*, contacts(*))").eq("brand_id", params.id),
  ]);

  const company = companies?.[0];
  const amazonUnavailable = jobs?.some((j) => j.error_message?.startsWith("Amazon data unavailable")) ?? false;
  const leadDataUnavailable = jobs?.some((j) => j.error_message?.includes("Company and decision-maker data unavailable")) ?? false;

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{brand.name}</h1>
            <p className="text-sm text-muted-foreground">{brand.marketplace}</p>
          </div>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
            + New research run
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Amazon Products ({products?.length ?? 0})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {products && products.length > 0 ? (
                  products.map((product) => {
                    const audit = Array.isArray(product.listing_audits) ? product.listing_audits[0] : product.listing_audits;
                    return (
                      <div key={product.id} className="flex items-center gap-4 rounded-md border border-border p-4">
                        {audit && <ScoreRing score={Number(audit.overall_score)} size={56} />}
                        <div className="flex-1">
                          <a href={product.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                            {product.title}
                          </a>
                          <p className="text-xs text-muted-foreground">
                            ASIN {product.asin} · {product.review_count ?? 0} reviews · {product.rating ?? "n/a"}★
                          </p>
                          <div className="mt-2">
                            <ClassificationBadge classification={product.classification} />
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : amazonUnavailable ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                    <p className="font-medium">Amazon data unavailable — authorization required</p>
                    <p className="mt-1 text-xs opacity-90">
                      Configure <code className="font-mono">SERPAPI_API_KEY</code> to enable real Amazon product discovery.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No products discovered yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Research Jobs</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {jobs && jobs.length > 0 ? (
                  jobs.map((job) => (
                    <Link
                      key={job.id}
                      href={`/jobs/${job.id}`}
                      className="flex items-center justify-between rounded-md border border-border p-3 text-sm hover:bg-muted/50"
                    >
                      <span>{formatDate(job.created_at)}</span>
                      <JobStatusBadge status={job.status} />
                    </Link>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No jobs yet.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div>
            <Card>
              <CardHeader>
                <CardTitle>Company</CardTitle>
              </CardHeader>
              <CardContent>
                {company ? (
                  <div className="flex flex-col gap-3">
                    <div>
                      <p className="font-medium">{company.name}</p>
                      {company.website && (
                        <a href={company.website} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                          {company.website}
                        </a>
                      )}
                      <p className="text-sm text-muted-foreground">{company.location}</p>
                    </div>
                    <div className="flex flex-col gap-3">
                      {((company.decision_makers as unknown as Array<Record<string, any>>) ?? []).map((dm) => {
                        const contact = Array.isArray(dm.contacts) ? dm.contacts[0] : dm.contacts;
                        return (
                          <div key={dm.id} className="rounded-md border border-border p-3">
                            <p className="text-sm font-medium">{dm.name}</p>
                            <p className="text-xs text-muted-foreground">{dm.job_title}</p>
                            {dm.linkedin_url && (
                              <a href={dm.linkedin_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                                LinkedIn
                              </a>
                            )}
                            {contact?.email && <p className="mt-1 text-xs">{contact.email}</p>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : leadDataUnavailable ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                    <p className="font-medium">Company data unavailable — authorization required</p>
                    <p className="mt-1 text-xs opacity-90">
                      Configure <code className="font-mono">HUNTER_API_KEY</code> to enable real company and decision-maker discovery.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No company research yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
