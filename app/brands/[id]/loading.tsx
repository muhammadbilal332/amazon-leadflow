import { Skeleton } from "@/components/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function BrandDetailLoading() {
  return (
    <div className="min-h-screen">
      <div className="h-14 border-b border-border bg-card" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Skeleton className="mb-6 h-7 w-48" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <Card>
              <CardContent className="flex flex-col gap-3 pt-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardContent className="pt-6">
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
