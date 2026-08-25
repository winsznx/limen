/**
 * Redaction for anything that leaves the proving path as a log line, a metric, or an
 * error string.
 *
 * A proving request contains the user's signed transaction and, inside its calldata,
 * the private viewing key the pool needs to compile client actions. None of it may
 * ever reach a log, a metrics label, D1, analytics, or an error surfaced to a client.
 * SECURITY.md states the rule; this file is the enforcement, and
 * `redact.test.ts` is the proof.
 */

const SENSITIVE_KEY_PATTERN =
  /(private|viewing|secret|signature|witness|seed|mnemonic|calldata|transaction|proof|authorization|cookie|token|key)/i;

/** Keys that are safe to keep even though they match the pattern above. */
const ALLOWED_KEYS = new Set([
  "publicKey",
  "public_key",
  "requestId",
  "request_id",
  "idempotencyKey",
  "tokenAddress",
  "token_address",
  "proofFactsCount",
  "keyCount",
]);

const REDACTED = "[redacted]";

/** A long hex run is assumed to be key or witness material wherever it appears. */
const LONG_HEX = /0x[0-9a-fA-F]{40,}/g;

export function redactString(value: string): string {
  return value.replace(LONG_HEX, REDACTED);
}

/**
 * Deep-redacts a value for logging. Structure is preserved so a log line stays useful:
 * arrays keep their length, objects keep their keys, and only values that could carry
 * secrets are replaced.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    // Felt arrays are the usual carrier of calldata, so they are summarised rather
    // than sampled: even one element can be key material.
    if (value.length > 8 && value.every((item) => typeof item === "string")) {
      return `[${value.length} values, ${REDACTED}]`;
    }
    return value.map((item) => redact(item, depth + 1));
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (ALLOWED_KEYS.has(key)) {
        output[key] = redact(entry, depth + 1);
      } else if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = REDACTED;
      } else {
        output[key] = redact(entry, depth + 1);
      }
    }
    return output;
  }
  return REDACTED;
}

/** Serialises a value for a log line, redacting first. Never throws. */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return REDACTED;
  }
}
