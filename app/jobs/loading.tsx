import { Skeleton } from "@/components/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function JobsLoading() {
  return (
    <div className="min-h-screen">
      <div className="h-14 border-b border-border bg-card" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Skeleton className="mb-6 h-7 w-48" />
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
