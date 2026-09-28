import { Nav } from "@/components/nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProviderStatusBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { allProviderStatuses } from "@/lib/providers/registry";
import { isDemoMode, arePaidApisEnabled } from "@/lib/providers/config";

export default function SettingsPage() {
  const statuses = allProviderStatuses();

  const groups: Array<{ title: string; items: { name: string; status: string }[] }> = [
    { title: "Amazon Discovery", items: statuses.amazon },
    { title: "Lead / Company Research", items: statuses.lead },
    { title: "Email Discovery & Verification", items: statuses.email },
    { title: "AI Analysis", items: statuses.ai },
    { title: "Google Sheets Export", items: statuses.sheets },
  ];

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Safety Switches</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:gap-8">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">DEMO_MODE</span>
              <Badge variant={isDemoMode() ? "success" : "outline"}>{String(isDemoMode())}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">PAID_APIS_ENABLED</span>
              <Badge variant={arePaidApisEnabled() ? "destructive" : "success"}>{String(arePaidApisEnabled())}</Badge>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.title}>
              <CardHeader>
                <CardTitle>{group.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <span className="font-mono">{item.name}</span>
                    <ProviderStatusBadge status={item.status as any} />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
