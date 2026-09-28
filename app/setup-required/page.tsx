import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SetupRequiredPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Supabase setup required</CardTitle>
          <CardDescription>
            Amazon LeadFlow uses Supabase for authentication and as its database. This step needs your own project
            credentials, which only you can obtain.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            1. Create a free project at{" "}
            <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-primary hover:underline">
              supabase.com
            </a>{" "}
            (no card required for the free tier).
          </p>
          <p>2. Copy your project URL, anon key, and service role key into <code className="font-mono">.env.local</code>.</p>
          <p>
            3. Apply <code className="font-mono">supabase/migrations/0001_init.sql</code> (via{" "}
            <code className="font-mono">npx supabase db push</code> or the SQL editor).
          </p>
          <p>4. Restart the dev server.</p>
          <p className="pt-2">Full instructions: <code className="font-mono">docs/SETUP.md</code>.</p>
        </CardContent>
      </Card>
    </div>
  );
}
