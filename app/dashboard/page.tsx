import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { NewResearchForm } from "@/components/new-research-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JobStatusBadge } from "@/components/status-badges";
import { formatDateTime } from "@/lib/utils";
import { demoModeActive } from "@/lib/orchestrator";
import { Badge } from "@/components/ui/badge";
import { Building2, CheckCircle2, Mail, Package, Users } from "lucide-react";

export default async function DashboardPage() {
  const supabase = createClient();

  const [
    { count: brandCount },
    { count: productCount },
    { count: completedJobCount },
    { data: recentJobs },
    { count: leadCount },
    { count: verifiedEmailCount },
  ] = await Promise.all([
    supabase.from("brands").select("*", { count: "exact", head: true }),
    supabase.from("amazon_products").select("*", { count: "exact", head: true }),
    supabase.from("research_jobs").select("*", { count: "exact", head: true }).eq("status", "COMPLETED"),
    supabase
      .from("research_jobs")
      .select("id, status, progress, created_at, brands(name)")
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("decision_makers").select("*", { count: "exact", head: true }),
    supabase.from("contacts").select("*", { count: "exact", head: true }).eq("email_status", "VALID"),
  ]);

  const completedJobs = completedJobCount ?? 0;

  const stats = [
    { label: "Total Brands", value: brandCount ?? 0, href: "/brands", icon: Building2 },
    { label: "Total Products", value: productCount ?? 0, href: "/brands", icon: Package },
    { label: "Completed Jobs", value: completedJobs, href: "/jobs", icon: CheckCircle2 },
    { label: "Leads Found", value: leadCount ?? 0, href: "/brands", icon: Users },
    { label: "Verified Emails", value: verifiedEmailCount ?? 0, href: "/brands", icon: Mail },
  ];

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Research any Amazon brand and surface decision-maker leads.</p>
          </div>
          {demoModeActive() && <Badge variant="secondary">DEMO MODE</Badge>}
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>New Research</CardTitle>
          </CardHeader>
          <CardContent>
            <NewResearchForm />
          </CardContent>
        </Card>

        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((stat) => (
            <Link key={stat.label} href={stat.href}>
              <Card className="transition-colors hover:border-primary/40 hover:bg-muted/40">
                <CardContent className="flex items-start justify-between pt-6">
                  <div>
                    <p className="text-2xl font-semibold">{stat.value}</p>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                  </div>
                  <stat.icon className="h-5 w-5 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Research Jobs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentJobs && recentJobs.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-muted-foreground">
                  <tr>
                    <th className="px-6 py-2 font-medium">Brand</th>
                    <th className="px-6 py-2 font-medium">Status</th>
                    <th className="px-6 py-2 font-medium">Progress</th>
                    <th className="px-6 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((job) => (
                    <tr key={job.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                      <td className="px-6 py-3">
                        <Link href={`/jobs/${job.id}`} className="font-medium hover:underline">
                          {(job.brands as unknown as { name: string })?.name ?? "Unknown"}
                        </Link>
                      </td>
                      <td className="px-6 py-3">
                        <JobStatusBadge status={job.status} />
                      </td>
                      <td className="px-6 py-3">{job.progress}%</td>
                      <td className="px-6 py-3 text-muted-foreground">{formatDateTime(job.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                No research jobs yet — start one above.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
