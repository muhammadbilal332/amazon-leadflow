// Central safety switches. Every provider MUST read these before doing any
// paid or network-billable operation. Nothing else in the app may bypass
// this module to reach a provider directly.

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE !== "false";
}

export function arePaidApisEnabled(): boolean {
  // Defensive default: absence or any value other than the literal string
  // "true" is treated as disabled.
  return process.env.PAID_APIS_ENABLED === "true";
}

/** In-memory free-quota tracker. Resets on process restart; good enough for
 * a single free-tier key used from one server process. Swap for a
 * Supabase-backed counter if you need it to survive restarts. */
class QuotaTracker {
  private exhausted = new Set<string>();

  markExhausted(provider: string) {
    this.exhausted.add(provider);
  }

  isExhausted(provider: string): boolean {
    return this.exhausted.has(provider);
  }
}

export const quotaTracker = new QuotaTracker();

export function timed<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  return fn().then((result) => ({ result, durationMs: Date.now() - start }));
}
