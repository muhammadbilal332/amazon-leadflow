import type { EmailGuess, EmailProvider, ProviderResult } from "@/lib/providers/types";
import type { EmailStatus } from "@/types/database";

function toEmailLocalPart(fullName: string): string {
  const [first, ...rest] = fullName.trim().toLowerCase().split(/\s+/);
  const last = rest.join("");
  return `${first}.${last || "team"}`;
}

const STATUS_CYCLE: EmailStatus[] = ["VALID", "ACCEPT_ALL", "UNKNOWN"];

export class MockEmailProvider implements EmailProvider {
  readonly name = "mock-email";

  status() {
    return "CONFIGURED" as const;
  }

  async findAndVerify(fullName: string, domain: string | null): Promise<ProviderResult<EmailGuess | null>> {
    const start = Date.now();
    if (!domain) {
      return { status: "SUCCESS", data: null, durationMs: Date.now() - start };
    }
    const local = toEmailLocalPart(fullName);
    const status = STATUS_CYCLE[fullName.length % STATUS_CYCLE.length];
    const guess: EmailGuess = {
      email: `${local}@${domain}`,
      status,
      verifiedAt: status === "VALID" || status === "INVALID" ? new Date().toISOString() : null,
    };
    return { status: "SUCCESS", data: guess, durationMs: Date.now() - start, requestIdentifier: `mock:${guess.email}` };
  }
}
