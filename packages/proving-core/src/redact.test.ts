import { describe, expect, it } from "vitest";
import { redact, redactString, safeStringify } from "./redact.js";

/**
 * These tests exist because the failure they guard against is silent and permanent: a
 * viewing key that reaches a log has leaked, and no later fix un-leaks it.
 */
describe("redaction", () => {
  const VIEWING_KEY = "0x0479d9b8a9a1e0f2b3c4d5e6f70819202122232425262728292a2b2c2d2e2f30";

  it("strips key-length hex from free text", () => {
    expect(redactString(`failed for key ${VIEWING_KEY}`)).toBe("failed for key [redacted]");
  });

  it("never emits a viewing key nested anywhere in a proving request", () => {
    const request = {
      requestId: "req_01",
      blockNumber: 100,
      transaction: {
        sender_address: "0x1234",
        calldata: ["0x1", "0x2", VIEWING_KEY, "0x4"],
        signature: ["0xaaa", "0xbbb"],
      },
    };
    expect(safeStringify(request)).not.toContain(VIEWING_KEY.slice(2, 20));
  });

  it("keeps the shape of a log line so it stays diagnosable", () => {
    const redacted = redact({ requestId: "req_01", blockNumber: 100, transaction: {} }) as Record<
      string,
      unknown
    >;
    expect(redacted.requestId).toBe("req_01");
    expect(redacted.blockNumber).toBe(100);
    expect(redacted.transaction).toBe("[redacted]");
  });

  it("summarises long felt arrays instead of sampling them", () => {
    // Sampling would be worse than useless: one element of calldata can be the key.
    const redacted = redact({ values: Array.from({ length: 40 }, () => VIEWING_KEY) }) as Record<
      string,
      unknown
    >;
    expect(redacted.values).toBe("[40 values, [redacted]]");
  });

  it("redacts errors without losing the error name", () => {
    const redacted = redact(new Error(`boom at ${VIEWING_KEY}`)) as { name: string; message: string };
    expect(redacted.name).toBe("Error");
    expect(redacted.message).toBe("boom at [redacted]");
  });

  it("keeps values that are safe by name", () => {
    const redacted = redact({ publicKey: "0xabc", proofFactsCount: 2 }) as Record<string, unknown>;
    expect(redacted.publicKey).toBe("0xabc");
    expect(redacted.proofFactsCount).toBe(2);
  });

  it("does not blow up or leak on a cycle", () => {
    const cyclic: Record<string, unknown> = { requestId: "req_02" };
    cyclic.self = cyclic;
    expect(() => safeStringify(cyclic)).not.toThrow();
  });

  it("stops at a bounded depth rather than recursing forever", () => {
    let nested: Record<string, unknown> = { leaf: VIEWING_KEY };
    for (let index = 0; index < 30; index += 1) nested = { level: nested };
    expect(safeStringify(nested)).not.toContain(VIEWING_KEY.slice(2, 20));
  });
});
