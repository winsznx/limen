import { ProvingError } from "./provider.js";

export interface RetryPolicy {
  /** Attempts after the first. Zero disables retrying. */
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries only what upstream defines as transient.
 *
 * Retry behaviour around proving is not invented here: a `ProvingError` carries its
 * own `retryable` flag, derived from the prover's documented JSON-RPC codes. Anything
 * else propagates on the first attempt, so a rejected proof or an invalid request
 * fails fast instead of being hammered.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  onRetry?: (attempt: number, error: ProvingError, delayMs: number) => void
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const provingError = error instanceof ProvingError ? error : undefined;
      if (!provingError?.retryable || attempt >= policy.maxRetries) throw error;
      const delayMs = Math.min(policy.baseDelayMs * 2 ** attempt, policy.maxDelayMs);
      onRetry?.(attempt, provingError, delayMs);
      await sleep(delayMs);
    }
  }
}
