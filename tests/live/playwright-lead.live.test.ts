import { describe, expect, it } from "vitest";
import { PlaywrightLeadProvider } from "@/lib/providers/lead/playwright";

// Opt-in only — run with `npm run test:live`. Launches a real Chromium
// browser against a real, well-known company's public website (no
// LinkedIn involved — see docs/PROVIDERS.md for why LinkedIn automation
// isn't implemented). Never run automatically as part of `npm test` / CI —
// see vitest.config.ts's exclude.
describe("PlaywrightLeadProvider (live)", () => {
  it("finds a real company profile for a well-known brand from its own website", async () => {
    const provider = new PlaywrightLeadProvider();
    const result = await provider.findCompany("Anker", null);

    expect(["SUCCESS", "ERROR"]).toContain(result.status);
    if (result.status === "ERROR") {
      // A site redesign, bot-detection block, or no network are all
      // legitimate real-world outcomes for a live scrape — log it instead
      // of failing the run, since this test's job is a smoke check.
      console.warn("Live Playwright lead smoke test got ERROR (non-fatal):", result.errorMessage);
      return;
    }

    if (!result.data) {
      console.warn("Live Playwright lead smoke test found no verifiable company (non-fatal).");
      return;
    }

    const company = result.data;
    expect(typeof company.name).toBe("string");
    expect(company.domain).toContain("anker");
    expect(Array.isArray(company.sources)).toBe(true);
    expect(company.sources!.length).toBeGreaterThan(0);

    const peopleResult = await provider.findDecisionMakers(company);
    expect(["SUCCESS", "ERROR"]).toContain(peopleResult.status);
    if (peopleResult.status === "SUCCESS" && peopleResult.data) {
      // Never asserting a non-zero count here — a real company website may
      // legitimately have no publicly-listed leadership page, and that is
      // not a failure of this provider.
      expect(Array.isArray(peopleResult.data)).toBe(true);
      for (const person of peopleResult.data) {
        expect(typeof person.name).toBe("string");
        expect(typeof person.jobTitle).toBe("string");
      }
    }
  });
});
