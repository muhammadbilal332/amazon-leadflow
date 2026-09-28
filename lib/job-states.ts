import type { JobStatus } from "@/types/database";

// Explicit state machine so "PENDING -> COMPLETED" (skipping the pipeline)
// or "COMPLETED -> RUNNING" (resurrecting a finished job without a retry)
// can never happen silently.
const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  PENDING: ["RUNNING", "DISCOVERING", "FAILED"],
  RUNNING: ["DISCOVERING", "ANALYZING", "ENRICHING", "VERIFYING", "COMPLETED", "PARTIAL", "FAILED"],
  DISCOVERING: ["ANALYZING", "PARTIAL", "FAILED"],
  ANALYZING: ["ENRICHING", "COMPLETED", "PARTIAL", "FAILED"],
  ENRICHING: ["VERIFYING", "COMPLETED", "PARTIAL", "FAILED"],
  VERIFYING: ["COMPLETED", "PARTIAL", "FAILED"],
  COMPLETED: ["PENDING"], // only via an explicit retry, which resets to PENDING
  PARTIAL: ["PENDING"],
  FAILED: ["PENDING"],
};

export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminalStatus(status: JobStatus): boolean {
  return status === "COMPLETED" || status === "PARTIAL" || status === "FAILED";
}
