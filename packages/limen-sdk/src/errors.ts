/**
 * Every way a clearance can fail, as a stable code the UI can branch on and a user can
 * be told what to do about. PRD §9.5 treats failures as first-class product surfaces,
 * so each carries whether retrying is safe.
 */
export type LimenErrorCode =
  | "CHALLENGE_NOT_FOUND"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_CONSUMED"
  | "WRONG_SUBJECT"
  | "WRONG_TARGET"
  | "WRONG_TOKEN"
  | "WRONG_ACTION"
  | "BELOW_THRESHOLD"
  | "ABOVE_THRESHOLD"
  | "INSUFFICIENT_SHIELDED_BALANCE"
  | "NOTES_IMMATURE"
  | "NOT_REGISTERED"
  | "WRONG_NETWORK"
  | "POOL_FEE_UNAFFORDABLE"
  | "ANONYMIZER_BLOCKED"
  | "PROVER_UNAVAILABLE"
  | "PROVER_BUSY"
  | "PROOF_REJECTED"
  | "TRANSACTION_REVERTED"
  | "RPC_UNAVAILABLE"
  | "UNKNOWN";

export interface LimenErrorInfo {
  readonly code: LimenErrorCode;
  /** Whether resubmitting the same operation unchanged could succeed. */
  readonly retryable: boolean;
  /** One sentence, addressed to the person who hit it. */
  readonly message: string;
}

const CATALOGUE: Record<LimenErrorCode, Omit<LimenErrorInfo, "code">> = {
  CHALLENGE_NOT_FOUND: {
    retryable: false,
    message: "No challenge exists with that identifier on this network.",
  },
  CHALLENGE_EXPIRED: {
    retryable: false,
    message: "This challenge has expired. Ask the application for a new one.",
  },
  CHALLENGE_CONSUMED: {
    retryable: false,
    message: "This challenge has already been cleared and cannot be used again.",
  },
  WRONG_SUBJECT: {
    retryable: false,
    message: "This challenge is bound to a different Limen subject.",
  },
  WRONG_TARGET: {
    retryable: false,
    message: "The challenge names a different target application.",
  },
  WRONG_TOKEN: { retryable: false, message: "The challenge requires a different token." },
  WRONG_ACTION: {
    retryable: false,
    message: "The target application does not recognise this challenge's action.",
  },
  BELOW_THRESHOLD: {
    retryable: false,
    message: "Less than the required threshold reached the anonymizer.",
  },
  ABOVE_THRESHOLD: {
    retryable: true,
    message:
      "More than the required threshold reached the anonymizer, which usually means a transfer landed while the proof was being generated. Rebuild and try again.",
  },
  INSUFFICIENT_SHIELDED_BALANCE: {
    retryable: false,
    message: "Your shielded notes do not cover the threshold for this token.",
  },
  NOTES_IMMATURE: {
    retryable: true,
    message: "Your notes are too new to spend. They become spendable about 10 blocks after creation.",
  },
  NOT_REGISTERED: {
    retryable: false,
    message: "This account is not registered with the STRK20 pool yet.",
  },
  WRONG_NETWORK: {
    retryable: false,
    message: "Your wallet is on a different network than this challenge.",
  },
  POOL_FEE_UNAFFORDABLE: {
    retryable: false,
    message: "The submitting account cannot cover the STRK20 pool fee for this transaction.",
  },
  ANONYMIZER_BLOCKED: {
    retryable: false,
    message: "The STRK20 pool has blocked this anonymizer from crediting open notes.",
  },
  PROVER_UNAVAILABLE: {
    retryable: true,
    message: "The Limen Prover is not reachable. Nothing was submitted, so retrying is safe.",
  },
  PROVER_BUSY: {
    retryable: true,
    message: "The Limen Prover is at capacity. Nothing was submitted, so retrying is safe.",
  },
  PROOF_REJECTED: {
    retryable: true,
    message:
      "The proof was not accepted, usually because it aged past the pool's validity window. Rebuild against a fresh block.",
  },
  TRANSACTION_REVERTED: {
    retryable: false,
    message: "The transaction reverted on chain. No capital moved and no challenge was consumed.",
  },
  RPC_UNAVAILABLE: {
    retryable: true,
    message: "The Starknet RPC endpoint did not respond.",
  },
  UNKNOWN: { retryable: false, message: "The clearance failed for an unrecognised reason." },
};

export class LimenError extends Error {
  override readonly name = "LimenError";
  readonly code: LimenErrorCode;
  readonly retryable: boolean;
  readonly detail: string | undefined;

  constructor(code: LimenErrorCode, detail?: string) {
    const entry = CATALOGUE[code];
    super(entry.message);
    this.code = code;
    this.retryable = entry.retryable;
    this.detail = detail;
  }

  toJSON(): LimenErrorInfo & { detail?: string } {
    return {
      code: this.code,
      retryable: this.retryable,
      message: this.message,
      ...(this.detail ? { detail: this.detail } : {}),
    };
  }
}

/**
 * Maps a Cairo panic reason or an RPC failure onto a Limen code.
 *
 * Contract error selectors are matched as substrings because Starknet surfaces them
 * inside longer trace strings, and the shape of that wrapper differs by node.
 */
export function classifyFailure(error: unknown): LimenError {
  const text = error instanceof Error ? error.message : String(error);

  const contractCodes: Array<[string, LimenErrorCode]> = [
    ["LIMEN_CHALLENGE_NOT_FOUND", "CHALLENGE_NOT_FOUND"],
    ["LIMEN_CHALLENGE_CONSUMED", "CHALLENGE_CONSUMED"],
    ["LIMEN_CHALLENGE_EXPIRED", "CHALLENGE_EXPIRED"],
    ["LIMEN_WRONG_SUBJECT", "WRONG_SUBJECT"],
    ["LIMEN_BELOW_THRESHOLD", "BELOW_THRESHOLD"],
    ["LIMEN_ABOVE_THRESHOLD", "ABOVE_THRESHOLD"],
    ["GATE_UNKNOWN_ACTION", "WRONG_ACTION"],
    ["GATE_WRONG_TOKEN", "WRONG_TOKEN"],
    ["GATE_CALLER_NOT_LIMEN", "WRONG_TARGET"],
    ["OPEN_NOTE_DEPOSITOR_BLOCKED", "ANONYMIZER_BLOCKED"],
    ["PROOF_EXPIRED", "PROOF_REJECTED"],
    ["INVALID_PROOF", "PROOF_REJECTED"],
    ["SENDER_NOT_REGISTERED", "NOT_REGISTERED"],
    ["NOTE_NOT_FOUND", "NOTES_IMMATURE"],
  ];
  for (const [needle, code] of contractCodes) {
    if (text.includes(needle)) return new LimenError(code, text.slice(0, 400));
  }

  if (/insufficient (balance|allowance)/i.test(text)) {
    return new LimenError("POOL_FEE_UNAFFORDABLE", text.slice(0, 400));
  }
  if (/service busy|-32005/.test(text)) return new LimenError("PROVER_BUSY", text.slice(0, 400));
  if (/ECONNREFUSED|fetch failed|ETIMEDOUT|AbortError/i.test(text)) {
    return new LimenError("PROVER_UNAVAILABLE", text.slice(0, 400));
  }
  if (/REVERTED|reverted/i.test(text)) {
    return new LimenError("TRANSACTION_REVERTED", text.slice(0, 400));
  }
  return new LimenError("UNKNOWN", text.slice(0, 400));
}
