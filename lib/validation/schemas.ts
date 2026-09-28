import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const createBrandSchema = z.object({
  brandName: z
    .string()
    .trim()
    .min(2, "Brand name must be at least 2 characters")
    .max(80, "Brand name must be under 80 characters"),
  marketplace: z.string().trim().min(3).default("amazon.com"),
});

export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const exportJobSchema = z.object({
  jobId: z.string().uuid(),
});

// --- AI structured-output schemas (validated before use; see lib/providers/ai) ---

export const listingComponentAssessmentSchema = z.object({
  titleAssessment: z.object({
    hasBrandName: z.boolean(),
    hasKeywords: z.boolean(),
    lengthOk: z.boolean(),
    notes: z.string(),
  }),
  bulletAssessment: z.object({
    count: z.number(),
    coversBenefits: z.boolean(),
    notes: z.string(),
  }),
  conversionAssessment: z.object({
    hasTrustSignals: z.boolean(),
    notes: z.string(),
  }),
});

export const privateLabelReasoningSchema = z.object({
  reasoning: z.string(),
});

export const companySummarySchema = z.object({
  summary: z.string(),
});

export function validateAiOutput(kind: string, output: unknown): { valid: boolean; data: unknown } {
  const schema =
    kind === "listing_component_assessment"
      ? listingComponentAssessmentSchema
      : kind === "private_label_reasoning"
        ? privateLabelReasoningSchema
        : kind === "company_summary"
          ? companySummarySchema
          : null;

  if (!schema) return { valid: false, data: output };
  const result = schema.safeParse(output);
  return { valid: result.success, data: result.success ? result.data : output };
}
