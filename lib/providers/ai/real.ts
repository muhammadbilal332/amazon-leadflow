import { arePaidApisEnabled } from "@/lib/providers/config";
import type { AiJsonRequest, AiProvider, ProviderResult } from "@/lib/providers/types";
import type { ProviderStatus } from "@/types/database";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** Hosted LLM calls are billed per token with no meaningful free tier, so
 * this adapter — regardless of which AI_PROVIDER name is configured — is
 * always gated behind PAID_APIS_ENABLED in addition to AI_API_KEY. */
export class RealAiProvider implements AiProvider {
  readonly name = process.env.AI_PROVIDER || "anthropic";

  private get apiKey(): string | undefined {
    return process.env.AI_API_KEY;
  }

  status(): ProviderStatus {
    if (!this.apiKey) return "NOT_CONFIGURED";
    if (!arePaidApisEnabled()) return "DISABLED";
    return "CONFIGURED";
  }

  async analyze(request: AiJsonRequest): Promise<ProviderResult<Record<string, unknown>>> {
    const start = Date.now();
    if (!this.apiKey || !arePaidApisEnabled()) {
      return {
        status: "SKIPPED_DISABLED",
        data: null,
        durationMs: Date.now() - start,
        errorMessage: !this.apiKey ? "AI_API_KEY not set" : "PAID_APIS_ENABLED=false",
      };
    }

    try {
      const res = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-5",
          max_tokens: 1024,
          messages: [
            {
              role: "user",
              content: `Return ONLY valid JSON (no prose) analyzing this data for "${request.kind}":\n${JSON.stringify(request.input)}`,
            },
          ],
        }),
      });

      if (!res.ok) {
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: `AI HTTP ${res.status}` };
      }

      const json = (await res.json()) as { content?: Array<{ text?: string }> };
      const text = json.content?.[0]?.text ?? "{}";
      const parsed = safeParseJson(text);
      if (parsed === null) {
        return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: "AI returned non-JSON output" };
      }
      return { status: "SUCCESS", data: parsed, durationMs: Date.now() - start, requestIdentifier: `${this.name}:${request.kind}` };
    } catch (err) {
      return { status: "ERROR", data: null, durationMs: Date.now() - start, errorMessage: err instanceof Error ? err.message : "unknown error" };
    }
  }
}

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
