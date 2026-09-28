import { describe, expect, it } from "vitest";
import { isTerminalStatus, isValidTransition } from "@/lib/job-states";

describe("isValidTransition", () => {
  it("allows the normal happy-path pipeline sequence", () => {
    expect(isValidTransition("PENDING", "DISCOVERING")).toBe(true);
    expect(isValidTransition("DISCOVERING", "ANALYZING")).toBe(true);
    expect(isValidTransition("ANALYZING", "ENRICHING")).toBe(true);
    expect(isValidTransition("ENRICHING", "VERIFYING")).toBe(true);
    expect(isValidTransition("VERIFYING", "COMPLETED")).toBe(true);
  });

  it("allows a no-op transition to the same state", () => {
    expect(isValidTransition("ANALYZING", "ANALYZING")).toBe(true);
  });

  it("rejects skipping straight from PENDING to COMPLETED", () => {
    expect(isValidTransition("PENDING", "COMPLETED")).toBe(false);
  });

  it("rejects resurrecting a completed job back to RUNNING", () => {
    expect(isValidTransition("COMPLETED", "RUNNING")).toBe(false);
  });

  it("allows a terminal job to be retried via PENDING", () => {
    expect(isValidTransition("FAILED", "PENDING")).toBe(true);
    expect(isValidTransition("PARTIAL", "PENDING")).toBe(true);
    expect(isValidTransition("COMPLETED", "PENDING")).toBe(true);
  });

  it("allows any active state to fail", () => {
    expect(isValidTransition("DISCOVERING", "FAILED")).toBe(true);
    expect(isValidTransition("ENRICHING", "FAILED")).toBe(true);
  });
});

describe("isTerminalStatus", () => {
  it("treats COMPLETED, PARTIAL, and FAILED as terminal", () => {
    expect(isTerminalStatus("COMPLETED")).toBe(true);
    expect(isTerminalStatus("PARTIAL")).toBe(true);
    expect(isTerminalStatus("FAILED")).toBe(true);
  });

  it("treats in-progress states as non-terminal", () => {
    expect(isTerminalStatus("PENDING")).toBe(false);
    expect(isTerminalStatus("RUNNING")).toBe(false);
    expect(isTerminalStatus("DISCOVERING")).toBe(false);
  });
});
