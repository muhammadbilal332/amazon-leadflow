"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useToast } from "@/components/toast-provider";

export function JobActions({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [exportState, setExportState] = useState<"idle" | "loading" | "done" | "not_configured" | "error">("idle");
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  async function handleSheetsExport() {
    setExportState("loading");
    const res = await fetch("/api/export/sheets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const json = await res.json();
    if (json.status === "SUCCESS") {
      setExportState("done");
      setSpreadsheetUrl(json.spreadsheetUrl);
      toast({ title: "Exported to Google Sheets", variant: "success" });
    } else if (json.status === "GOOGLE_SHEETS_NOT_CONFIGURED") {
      setExportState("not_configured");
      toast({ title: "Google Sheets isn't connected", description: "Use Download CSV instead, or add Google credentials.", variant: "info" });
    } else {
      setExportState("error");
      toast({ title: "Export failed", description: json.message, variant: "error" });
    }
  }

  async function handleRetry() {
    setRetrying(true);
    await fetch(`/api/jobs/${jobId}/run`, { method: "POST" });
    setRetrying(false);
    toast({ title: "Job restarted", description: "Progress will update automatically.", variant: "success" });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a href={`/api/export/csv?jobId=${jobId}`} download className={buttonVariants({ variant: "outline" })}>
        <Download className="h-4 w-4" />
        Download CSV
      </a>
      <Button onClick={handleSheetsExport} disabled={exportState === "loading"} variant="ghost">
        {exportState === "loading" ? "Exporting..." : "Export to Google Sheets"}
      </Button>
      <Button onClick={handleRetry} disabled={retrying} variant="ghost">
        {retrying ? "Retrying..." : "Retry / Re-run"}
      </Button>
      {exportState === "done" && spreadsheetUrl && (
        <a href={spreadsheetUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
          Open spreadsheet
        </a>
      )}
      {exportState === "not_configured" && (
        <span className="text-sm text-muted-foreground">
          Google Sheets isn&apos;t connected — set GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN to enable it, or use Download CSV.
        </span>
      )}
      {exportState === "error" && <span className="text-sm text-destructive">Export failed. See workflow errors below.</span>}
    </div>
  );
}
