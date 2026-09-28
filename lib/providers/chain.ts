import type { ProviderResult } from "@/lib/providers/types";

/** Walks a provider chain in order and returns the first SUCCESS result,
 * falling back to the next provider on ERROR/SKIPPED_QUOTA/SKIPPED_DISABLED.
 * If every provider fails, returns the last result seen (never throws) so
 * callers can log it and continue the job as PARTIAL rather than crash. */
export async function callProviderChain<P extends { name: string }, R>(
  chain: P[],
  fn: (p: P) => Promise<ProviderResult<R>>,
): Promise<{ providerName: string; result: ProviderResult<R> }> {
  let last: ProviderResult<R> = { status: "ERROR", data: null, durationMs: 0, errorMessage: "no providers configured" };
  let lastName = "none";
  for (const provider of chain) {
    const result = await fn(provider);
    last = result;
    lastName = provider.name;
    if (result.status === "SUCCESS") return { providerName: provider.name, result };
  }
  return { providerName: lastName, result: last };
}
