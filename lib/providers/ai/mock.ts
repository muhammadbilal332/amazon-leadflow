import type { AiJsonRequest, AiProvider, ProviderResult } from "@/lib/providers/types";

/** Produces plausible, schema-shaped structured output without calling any
 * external model. Used whenever AI_PROVIDER=mock (the default) or when no
 * AI_API_KEY is configured. */
export class MockAiProvider implements AiProvider {
  readonly name = "mock-ai";

  status() {
    return "CONFIGURED" as const;
  }

  async analyze(request: AiJsonRequest): Promise<ProviderResult<Record<string, unknown>>> {
    const start = Date.now();
    const output = buildMockOutput(request);
    return { status: "SUCCESS", data: output, durationMs: Date.now() - start, requestIdentifier: `mock-ai:${request.kind}` };
  }
}

function buildMockOutput(request: AiJsonRequest): Record<string, unknown> {
  switch (request.kind) {
    case "listing_component_assessment": {
      const title = String(request.input.title ?? "");
      const bullets = Array.isArray(request.input.bulletPoints) ? (request.input.bulletPoints as string[]) : [];
      return {
        titleAssessment: {
          hasBrandName: title.length > 0,
          hasKeywords: title.split(" ").length >= 5,
          lengthOk: title.length >= 40 && title.length <= 200,
          notes: title.length < 40 ? "Title is shorter than typical high-performing listings." : "Title length is within a reasonable range.",
        },
        bulletAssessment: {
          count: bullets.length,
          coversBenefits: bullets.some((b) => /benefit|help|easy|comfort/i.test(b)),
          notes: bullets.length < 5 ? "Fewer than 5 bullet points; consider using all available slots." : "Bullet count is adequate.",
        },
        conversionAssessment: {
          hasTrustSignals: /guarantee|warranty|certified/i.test(String(request.input.description ?? "")),
          notes: "Consider adding explicit trust signals (warranty, certifications, guarantees) if not already present.",
        },
      };
    }
    case "private_label_reasoning": {
      return {
        reasoning:
          "Mock analysis: signals were evaluated deterministically from seller count, brand-label consistency, and catalog breadth.",
      };
    }
    case "company_summary": {
      const name = String(request.input.name ?? "the company");
      return { summary: `${name} appears to be an active consumer brand selling on Amazon; verify details via its website before outreach.` };
    }
    default:
      return { notes: "No mock handler for this analysis kind; returning empty structured output." };
  }
}
