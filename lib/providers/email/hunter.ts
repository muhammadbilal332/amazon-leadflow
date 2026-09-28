import { quotaTracker } from "@/lib/providers/config";
import type { EmailGuess, EmailProvider, ProviderResult } from "@/lib/providers/types";
import type { EmailStatus, ProviderStatus } from "@/types/database";

const HUNTER_BASE = "https://api.hunter.io/v2";

/** Hunter.io free plan includes 25 email finder + 50 verifier requests per
 * month. We never upgrade automatically — once the free quota is exhausted
 * we mark it and the orchestrator falls back to the mock provider. */
export class HunterEmailProvider implements EmailProvider {
  readonly name = "hunter";

  private get apiKey(): string | undefined {
    return process.env.HUNTER_API_KEY;
  }

  status(): ProviderStatus {
    if (!this.apiKey) return "NOT_CONFIGURED";
    if (quotaTracker.isExhausted(this.name)) return "FREE_QUOTA_EXHAUSTED";
    return "FREE_QUOTA_UNKNOWN";
  }

  async findAndVerify(fullName: string, domain: string | null): Promise<ProviderResult<EmailGuess | null>> {
    const start = Date.now();
    if (!this.apiKey) {
      return { status: "SKIPPED_DISABLED", data: null, durationMs: Date.now() - start, errorMessage: "HUNTER_API_KEY not set" };
    }
    if (!domain) {
      return { status: "SUCCESS", data: null, durationMs: Date.now() - start };
    }
    if (quotaTracker.isExhausted(this.name)) {
      return { status: "SKIPPED_QUOTA", data: null, durationMs: Date.now() - start, errorMessage: "FREE_QUOTA_EXHAUSTED" };
    }

    const [firstName, ...rest] = fullName.trim().split(/\s+/);
    const lastName = rest.join(" ");

    try {
      const findParams = new URLSearchParams({
        domain,
        first_name: firstName ?? "",
        last_name: lastName || firstName || "",
        api_key: this.apiKey,
      });
      const findRes = await fetch(`${HUNTER_BASE}/email-finder?${findParams.toString()}`);

      if (findRes.status === 429) {
        quotaTracker.markExhausted(this.name);
        return { status: "SKIPPED_QUOTA", data: null, durationMs: Date.now() - start, errorMessage: "FREE_QUOTA_EXHAUSTED" };
      }
      if (!findRes.ok) {
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: `Hunter HTTP ${findRes.status}` };
      }

      const findJson = (await findRes.json()) as { data?: { email?: string; score?: number } };
      const email = findJson.data?.email;
      if (!email) {
        return { status: "SUCCESS", data: null, durationMs: Date.now() - start, requestIdentifier: `hunter:${domain}` };
      }

      const verifyParams = new URLSearchParams({ email, api_key: this.apiKey });
      const verifyRes = await fetch(`${HUNTER_BASE}/email-verifier?${verifyParams.toString()}`);

      let status: EmailStatus = "UNKNOWN";
      if (verifyRes.ok) {
        const verifyJson = (await verifyRes.json()) as { data?: { status?: string } };
        status = mapHunterStatus(verifyJson.data?.status);
      } else if (verifyRes.status === 429) {
        quotaTracker.markExhausted(this.name);
      }

      const guess: EmailGuess = {
        email,
        status,
        verifiedAt: status === "VALID" || status === "INVALID" ? new Date().toISOString() : null,
      };
      return { status: "SUCCESS", data: guess, durationMs: Date.now() - start, requestIdentifier: `hunter:${email}` };
    } catch (err) {
      return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: err instanceof Error ? err.message : "unknown error" };
    }
  }
}

function mapHunterStatus(raw: string | undefined): EmailStatus {
  switch (raw) {
    case "valid":
      return "VALID";
    case "invalid":
      return "INVALID";
    case "accept_all":
      return "ACCEPT_ALL";
    default:
      return "UNKNOWN";
  }
}
