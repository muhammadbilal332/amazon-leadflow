"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { JobStatus } from "@/types/database";

const TERMINAL_STATUSES: JobStatus[] = ["COMPLETED", "PARTIAL", "FAILED"];

/** Job creation returns as soon as the row exists — the pipeline runs in
 * the background. This polls the server component's data (via a soft
 * navigation refresh) every couple of seconds while the job is still in
 * progress, so the progress bar and status badge update live instead of
 * requiring a manual reload. Stops itself once the job reaches a terminal
 * status. */
export function JobPoller({ status }: { status: JobStatus }) {
  const router = useRouter();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (TERMINAL_STATUSES.includes(status)) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => router.refresh(), 1800);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [status, router]);

  return null;
}
