import { Skeleton } from "@/components/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function JobDetailLoading() {
  return (
    <div className="min-h-screen">
      <div className="h-14 border-b border-border bg-card" />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-40" />
          </div>
          <Skeleton className="h-6 w-24" />
        </div>
        <Card className="mb-6">
          <CardContent className="flex flex-col gap-3 pt-6">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-2 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
