import { Badge } from "@/components/ui/badge";
import type { EmailStatus, IssueSeverity, JobStatus, PrivateLabelClassification, ProviderStatus } from "@/types/database";

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const variant =
    status === "COMPLETED"
      ? "success"
      : status === "FAILED"
        ? "destructive"
        : status === "PARTIAL"
          ? "warning"
          : status === "PENDING"
            ? "outline"
            : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

export function ClassificationBadge({ classification }: { classification: PrivateLabelClassification }) {
  const variant =
    classification === "LIKELY_PRIVATE_LABEL"
      ? "success"
      : classification === "POSSIBLE_PRIVATE_LABEL"
        ? "secondary"
        : classification === "LIKELY_RESELLER" || classification === "WHOLESALE"
          ? "warning"
          : "outline";
  return <Badge variant={variant}>{classification.replaceAll("_", " ")}</Badge>;
}

export function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  const variant =
    severity === "CRITICAL" ? "destructive" : severity === "HIGH" ? "warning" : severity === "MEDIUM" ? "secondary" : "outline";
  return <Badge variant={variant}>{severity}</Badge>;
}

export function EmailStatusBadge({ status }: { status: EmailStatus }) {
  const variant =
    status === "VALID" ? "success" : status === "INVALID" ? "destructive" : status === "ACCEPT_ALL" ? "warning" : "outline";
  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}

export function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
  const variant =
    status === "CONFIGURED"
      ? "success"
      : status === "FREE_QUOTA_EXHAUSTED" || status === "ERROR"
        ? "destructive"
        : status === "DISABLED" || status === "NOT_CONFIGURED"
          ? "outline"
          : "secondary";
  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}
