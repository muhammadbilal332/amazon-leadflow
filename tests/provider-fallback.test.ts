import { describe, expect, it } from "vitest";
import { callProviderChain } from "@/lib/providers/chain";
import type { ProviderResult } from "@/lib/providers/types";

interface FakeProvider {
  name: string;
  result: ProviderResult<string>;
}

function fakeCall(p: FakeProvider) {
  return Promise.resolve(p.result);
}

describe("callProviderChain", () => {
  it("returns the first provider's result on SUCCESS without calling the next", async () => {
    let secondCalled = false;
    const chain: FakeProvider[] = [
      { name: "real", result: { status: "SUCCESS", data: "real-data", durationMs: 1 } },
      { name: "mock", result: { status: "SUCCESS", data: "mock-data", durationMs: 1 } },
    ];
    const { providerName, result } = await callProviderChain(chain, async (p) => {
      if (p.name === "mock") secondCalled = true;
      return fakeCall(p);
    });
    expect(providerName).toBe("real");
    expect(result.data).toBe("real-data");
    expect(secondCalled).toBe(false);
  });

  it("falls back to the next provider when the first errors", async () => {
    const chain: FakeProvider[] = [
      { name: "real", result: { status: "ERROR", data: null, durationMs: 1, errorMessage: "boom" } },
      { name: "mock", result: { status: "SUCCESS", data: "mock-data", durationMs: 1 } },
    ];
    const { providerName, result } = await callProviderChain(chain, fakeCall);
    expect(providerName).toBe("mock");
    expect(result.data).toBe("mock-data");
  });

  it("falls back when the first provider reports SKIPPED_QUOTA", async () => {
    const chain: FakeProvider[] = [
      { name: "real", result: { status: "SKIPPED_QUOTA", data: null, durationMs: 1, errorMessage: "FREE_QUOTA_EXHAUSTED" } },
      { name: "mock", result: { status: "SUCCESS", data: "mock-data", durationMs: 1 } },
    ];
    const { providerName } = await callProviderChain(chain, fakeCall);
    expect(providerName).toBe("mock");
  });

  it("falls back when the first provider is SKIPPED_DISABLED (paid API gate)", async () => {
    const chain: FakeProvider[] = [
      { name: "real", result: { status: "SKIPPED_DISABLED", data: null, durationMs: 1, errorMessage: "PAID_APIS_ENABLED=false" } },
      { name: "mock", result: { status: "SUCCESS", data: "mock-data", durationMs: 1 } },
    ];
    const { providerName } = await callProviderChain(chain, fakeCall);
    expect(providerName).toBe("mock");
  });

  it("returns the last failure without throwing when every provider fails", async () => {
    const chain: FakeProvider[] = [
      { name: "real", result: { status: "ERROR", data: null, durationMs: 1, errorMessage: "boom" } },
      { name: "mock", result: { status: "ERROR", data: null, durationMs: 1, errorMessage: "also boom" } },
    ];
    const { providerName, result } = await callProviderChain(chain, fakeCall);
    expect(providerName).toBe("mock");
    expect(result.status).toBe("ERROR");
  });

  it("returns a safe default when the chain is empty", async () => {
    const { providerName, result } = await callProviderChain<FakeProvider, string>([], fakeCall);
    expect(providerName).toBe("none");
    expect(result.status).toBe("ERROR");
  });
});
