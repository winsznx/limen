/**
 * The proving seam.
 *
 * Limen never talks to a prover directly. Everything goes through this interface so
 * the self-hosted Limen Prover, a wallet-managed prover, and the test double are
 * interchangeable, and so the app can report which one produced a given proof.
 */

export type ProviderKind = "limen-self-hosted" | "wallet-managed" | "external" | "stub";

export interface ProviderHealth {
  readonly healthy: boolean;
  readonly kind: ProviderKind;
  /** Human name shown in the UI, e.g. "Limen Prover". */
  readonly name: string;
  /** JSON-RPC spec version the prover reports, when reachable. */
  readonly specVersion?: string;
  /** Round-trip time of the health probe, in milliseconds. */
  readonly latencyMs?: number;
  /** Jobs currently proving. */
  readonly activeJobs?: number;
  /** Jobs admitted and waiting. */
  readonly queueDepth?: number;
  /** Why the provider is unhealthy. Never contains request content. */
  readonly reason?: string;
  readonly checkedAt: string;
}

/** An Invoke V3 transaction, exactly as `starknet_proveTransaction` expects it. */
export interface ProvingRequest {
  /** Finalized block to execute against. Pending blocks are rejected by the prover. */
  readonly blockNumber: number;
  readonly transaction: Record<string, unknown>;
  /**
   * Caller-supplied key that makes a retry safe. Two requests with the same key
   * return the same outcome rather than proving twice.
   */
  readonly idempotencyKey?: string;
}

export interface ProvingResult {
  /** Base64 proof bytes, as returned by the prover. */
  readonly proof: string;
  readonly proofFacts: string[];
  readonly messagesToL1: Array<{
    from_address: string;
    to_address: string;
    payload: string[];
  }>;
  /**
   * Typed side channel. Carries the deposit screening signature when the proving
   * deployment runs the screening sidecar; absent for transactions that need none,
   * which includes every Limen clearance.
   */
  readonly additionalData?: { signature?: { issued_at: number; sig_r: string; sig_s: string } };
  readonly meta: ProvingMeta;
}

export interface ProvingMeta {
  readonly requestId: string;
  readonly provider: ProviderKind;
  readonly providerName: string;
  /** Time spent proving, excluding queue wait. */
  readonly durationMs: number;
  readonly queueWaitMs: number;
  readonly blockNumber: number;
  /** True when this result was replayed from an earlier identical request. */
  readonly deduplicated: boolean;
  readonly attempts: number;
}

export interface LimenProvingProvider {
  readonly kind: ProviderKind;
  readonly name: string;
  health(): Promise<ProviderHealth>;
  prove(request: ProvingRequest): Promise<ProvingResult>;
}

/** Terminal states a proving job can end in. */
export type ProvingFailureKind =
  | "invalid_request"
  | "block_not_found"
  | "validation_failed"
  | "unsupported_transaction"
  | "busy"
  | "timeout"
  | "unavailable"
  | "internal";

export class ProvingError extends Error {
  override readonly name = "ProvingError";
  readonly kind: ProvingFailureKind;
  /** Whether the same request may be retried unchanged. */
  readonly retryable: boolean;
  readonly requestId: string | undefined;

  constructor(
    kind: ProvingFailureKind,
    message: string,
    options?: { retryable?: boolean; requestId?: string }
  ) {
    super(message);
    this.kind = kind;
    this.retryable = options?.retryable ?? DEFAULT_RETRYABLE[kind];
    this.requestId = options?.requestId;
  }
}

/**
 * Which failures are transient.
 *
 * Only states upstream defines as transient are retryable. A cryptographic or
 * validation failure is never retried: repeating it cannot change the outcome and
 * would only burn prover capacity.
 */
const DEFAULT_RETRYABLE: Record<ProvingFailureKind, boolean> = {
  invalid_request: false,
  block_not_found: false,
  validation_failed: false,
  unsupported_transaction: false,
  busy: true,
  timeout: true,
  unavailable: true,
  internal: false,
};

/** JSON-RPC error codes the transaction prover returns, per its published API. */
export const PROVER_RPC_CODES = {
  blockNotFound: 24,
  accountValidationFailed: 55,
  unsupportedTransactionVersion: 61,
  invalidTransactionInput: 1000,
  serviceBusy: -32005,
  internalError: -32603,
  /** Added by the screening sidecar, not the prover itself. */
  transactionRejected: 10000,
} as const;

export function classifyProverRpcCode(code: number): ProvingFailureKind {
  switch (code) {
    case PROVER_RPC_CODES.blockNotFound:
      return "block_not_found";
    case PROVER_RPC_CODES.accountValidationFailed:
      return "validation_failed";
    case PROVER_RPC_CODES.unsupportedTransactionVersion:
      return "unsupported_transaction";
    case PROVER_RPC_CODES.invalidTransactionInput:
    case PROVER_RPC_CODES.transactionRejected:
      return "invalid_request";
    case PROVER_RPC_CODES.serviceBusy:
      return "busy";
    default:
      return "internal";
  }
}
