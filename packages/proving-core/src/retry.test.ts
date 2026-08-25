import { describe, expect, it } from "vitest";
import { ProvingError, classifyProverRpcCode, PROVER_RPC_CODES } from "./provider.js";
import { withRetry } from "./retry.js";

describe("prover failure classification", () => {
  it("maps every documented prover code", () => {
    expect(classifyProverRpcCode(PROVER_RPC_CODES.blockNotFound)).toBe("block_not_found");
    expect(classifyProverRpcCode(PROVER_RPC_CODES.accountValidationFailed)).toBe("validation_failed");
    expect(classifyProverRpcCode(PROVER_RPC_CODES.unsupportedTransactionVersion)).toBe(
      "unsupported_transaction"
    );
    expect(classifyProverRpcCode(PROVER_RPC_CODES.invalidTransactionInput)).toBe("invalid_request");
    expect(classifyProverRpcCode(PROVER_RPC_CODES.serviceBusy)).toBe("busy");
    expect(classifyProverRpcCode(PROVER_RPC_CODES.internalError)).toBe("internal");
    expect(classifyProverRpcCode(PROVER_RPC_CODES.transactionRejected)).toBe("invalid_request");
  });

  it("treats only busy, timeout and unavailable as transient", () => {
    expect(new ProvingError("busy", "").retryable).toBe(true);
    expect(new ProvingError("timeout", "").retryable).toBe(true);
    expect(new ProvingError("unavailable", "").retryable).toBe(true);

    // Retrying any of these cannot change the outcome; it only burns prover capacity.
    expect(new ProvingError("invalid_request", "").retryable).toBe(false);
    expect(new ProvingError("validation_failed", "").retryable).toBe(false);
    expect(new ProvingError("unsupported_transaction", "").retryable).toBe(false);
    expect(new ProvingError("block_not_found", "").retryable).toBe(false);
    expect(new ProvingError("internal", "").retryable).toBe(false);
  });
});

describe("retry", () => {
  const fast = { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2 };

  it("retries a transient failure and returns the eventual success", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new ProvingError("busy", "at capacity");
      return "proved";
    }, fast);
    expect(result).toBe("proved");
    expect(attempts).toBe(3);
  });

  it("never retries a cryptographic or validation failure", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts += 1;
        throw new ProvingError("validation_failed", "__validate__ reverted");
      }, fast)
    ).rejects.toThrow("__validate__ reverted");
    expect(attempts).toBe(1);
  });

  it("gives up after the configured number of retries", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts += 1;
        throw new ProvingError("busy", "still busy");
      }, fast)
    ).rejects.toThrow("still busy");
    expect(attempts).toBe(4);
  });

  it("does not retry an error that is not a ProvingError", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts += 1;
        throw new Error("something else");
      }, fast)
    ).rejects.toThrow("something else");
    expect(attempts).toBe(1);
  });

  it("caps the backoff so a large retry budget cannot schedule an unbounded sleep", async () => {
    const delays: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw new ProvingError("busy", "busy");
        },
        { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 4 },
        (_attempt, _error, delayMs) => delays.push(delayMs)
      )
    ).rejects.toThrow();
    expect(Math.max(...delays)).toBe(4);
  });
});
