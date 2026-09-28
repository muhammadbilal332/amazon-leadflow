import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/nav";
import { Card, CardContent } from "@/components/ui/card";
import { JobStatusBadge } from "@/components/status-badges";
import { formatDateTime } from "@/lib/utils";

export default async function JobsPage() {
  const supabase = createClient();
  const { data: jobs } = await supabase
    .from("research_jobs")
    .select("id, status, progress, demo_mode, created_at, brands(name)")
    .order("created_at", { ascending: false });

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Research Jobs</h1>
        <Card>
          <CardContent className="p-0">
            {jobs && jobs.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-muted-foreground">
                  <tr>
                    <th className="px-6 py-2 font-medium">Brand</th>
                    <th className="px-6 py-2 font-medium">Status</th>
                    <th className="px-6 py-2 font-medium">Progress</th>
                    <th className="px-6 py-2 font-medium">Mode</th>
                    <th className="px-6 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
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
                      <td className="px-6 py-3 text-muted-foreground">{job.demo_mode ? "Demo" : "Live"}</td>
                      <td className="px-6 py-3 text-muted-foreground">{formatDateTime(job.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">No jobs yet.</p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
