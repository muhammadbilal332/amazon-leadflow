import { describe, expect, it } from "vitest";
import { rowsToCsv } from "@/lib/export";
import type { SheetsExportRow } from "@/lib/providers/types";

function row(overrides: Partial<SheetsExportRow> = {}): SheetsExportRow {
  return {
    brand: "Acme",
    amazonProduct: "Acme Widget",
    asin: "B0TEST0001",
    amazonUrl: "https://www.amazon.com/dp/B0TEST0001",
    classification: "LIKELY_PRIVATE_LABEL",
    confidence: 0.85,
    auditScore: 72,
    majorIssues: "none",
    company: "Acme Inc.",
    decisionMaker: "Jane Doe",
    jobTitle: "Founder & CEO",
    linkedinUrl: "https://www.linkedin.com/in/janedoe",
    email: "jane@acme.com",
    emailStatus: "VALID",
    researchDate: "2026-01-01",
    ...overrides,
  };
}

describe("rowsToCsv", () => {
  it("writes a header row followed by one line per data row", () => {
    const csv = rowsToCsv([row(), row({ asin: "B0TEST0002" })]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      "Brand,Amazon Product,ASIN,Amazon URL,Private Label Classification,Confidence,Audit Score,Major Issues,Company,Decision Maker,Job Title,LinkedIn URL,Email,Email Status,Research Date",
    );
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    const csv = rowsToCsv([row({ amazonProduct: 'Widget, "Pro" Edition\nNew!' })]);
    expect(csv).toContain('"Widget, ""Pro"" Edition\nNew!"');
  });

  it("produces an empty-but-valid CSV (header only) for zero rows", () => {
    const csv = rowsToCsv([]);
    expect(csv.trim().split("\r\n")).toHaveLength(1);
  });
});
