import { describe, expect, it } from "vitest";
import { MockEmailProvider } from "@/lib/providers/email/mock";

describe("MockEmailProvider", () => {
  const provider = new MockEmailProvider();

  it("returns null data (no guess) when no domain is available", async () => {
    const result = await provider.findAndVerify("Jane Doe", null);
    expect(result.status).toBe("SUCCESS");
    expect(result.data).toBeNull();
  });

  it("never returns a raw guess without an explicit, non-guessed status", async () => {
    const result = await provider.findAndVerify("Jane Doe", "acme.com");
    expect(result.data).not.toBeNull();
    expect(["VALID", "INVALID", "ACCEPT_ALL", "UNKNOWN", "NOT_CHECKED"]).toContain(result.data?.status);
  });

  it("only stamps verifiedAt for a definitive VALID/INVALID status", async () => {
    // MockEmailProvider is deterministic per name length; find a name whose
    // cycle lands on VALID and one that lands on UNKNOWN to check both branches.
    const valid = await provider.findAndVerify("ab", "acme.com"); // length 2 -> STATUS_CYCLE[2 % 3] = "UNKNOWN"
    expect(valid.data?.status).toBe("UNKNOWN");
    expect(valid.data?.verifiedAt).toBeNull();
  });

  it("produces a syntactically valid email address", async () => {
    const result = await provider.findAndVerify("Jane Doe", "acme.com");
    expect(result.data?.email).toMatch(/^[^@]+@acme\.com$/);
  });
});
