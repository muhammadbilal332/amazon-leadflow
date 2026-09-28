import { describe, expect, it } from "vitest";
import { createBrandSchema, loginSchema, validateAiOutput } from "@/lib/validation/schemas";

describe("loginSchema", () => {
  it("accepts a valid email and non-empty password", () => {
    const result = loginSchema.safeParse({ email: "developer@amazonleadflow.local", password: "Dev@AmazonLeadFlow2026!" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "something" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({ email: "developer@amazonleadflow.local", password: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing email or password", () => {
    expect(loginSchema.safeParse({ password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
  });

  it("trims whitespace from the email but not the password", () => {
    const result = loginSchema.safeParse({ email: "  developer@amazonleadflow.local  ", password: "  spaced  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("developer@amazonleadflow.local");
      expect(result.data.password).toBe("  spaced  ");
    }
  });
});

describe("createBrandSchema", () => {
  it("accepts a valid brand name and applies the default marketplace", () => {
    const result = createBrandSchema.safeParse({ brandName: "Acme" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.marketplace).toBe("amazon.com");
  });

  it("rejects a brand name that is too short", () => {
    const result = createBrandSchema.safeParse({ brandName: "A" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing brand name", () => {
    const result = createBrandSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("trims whitespace from the brand name", () => {
    const result = createBrandSchema.safeParse({ brandName: "  Acme  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.brandName).toBe("Acme");
  });
});

describe("validateAiOutput", () => {
  it("marks well-formed listing_component_assessment output as valid", () => {
    const { valid } = validateAiOutput("listing_component_assessment", {
      titleAssessment: { hasBrandName: true, hasKeywords: true, lengthOk: true, notes: "ok" },
      bulletAssessment: { count: 5, coversBenefits: true, notes: "ok" },
      conversionAssessment: { hasTrustSignals: true, notes: "ok" },
    });
    expect(valid).toBe(true);
  });

  it("marks malformed AI output as invalid instead of trusting it", () => {
    const { valid } = validateAiOutput("listing_component_assessment", { garbage: true });
    expect(valid).toBe(false);
  });

  it("marks output for an unknown analysis kind as invalid", () => {
    const { valid } = validateAiOutput("unknown_kind", { anything: true });
    expect(valid).toBe(false);
  });
});
