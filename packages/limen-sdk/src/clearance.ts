import { num } from "starknet";
import { LimenError } from "./errors.js";
import type { Challenge } from "./challenge.js";

/**
 * The STRK20 action list a Limen clearance compiles to.
 *
 * Kept as an explicit, inspectable plan rather than being built inline, because it is
 * the exact shape reviewers need to check against the pool's phase rules, and because
 * the UI shows the user what they are about to sign.
 *
 * Phases, in the order the pool requires them:
 *
 *   4  UseNote        spend shielded notes covering the threshold
 *   5  CreateOpenNote the slot the returned capital is credited into
 *   5  CreateEncNote  change, when the selected notes exceed the threshold
 *   6  Withdraw       exactly the threshold, to the Limen Anonymizer
 *   7  ComputeAndInvoke  privacy_compute then privacy_invoke_with_computation
 *
 * There is no `Deposit` action anywhere in it, which is why a clearance needs no
 * screening attestation and can be proven by the Limen self-hosted prover
 * (DECISIONS.md D-008).
 */
export interface ClearancePlan {
  readonly challengeId: string;
  readonly subject: string;
  readonly token: string;
  /** Exact amount withdrawn to the anonymizer. Equals the challenge threshold. */
  readonly withdrawAmount: bigint;
  readonly anonymizer: string;
  readonly target: string;
  /** Where the returned shielded note lands. */
  readonly noteRecipient: string;
  readonly provingBlockId: number;
  /** Pool fee in FRI the submitting account must be able to pay, read live. */
  readonly poolFee: bigint;
  /** What becomes public if this is submitted. Rendered verbatim in the UI. */
  readonly disclosure: PrivacyDisclosure;
}

export interface PrivacyDisclosure {
  readonly becomesPublic: readonly string[];
  readonly staysPrivate: readonly string[];
  readonly caveats: readonly string[];
}

/**
 * The privacy boundary, stated concretely for one clearance.
 *
 * PRD §6 forbids vague claims, so this enumerates what an observer actually learns
 * from the transaction rather than gesturing at "privacy". Every line here is
 * something a reader can go and confirm in the receipt.
 */
export function disclosureFor(challenge: Challenge, symbol: string): PrivacyDisclosure {
  return {
    becomesPublic: [
      `The token being proven: ${symbol}.`,
      `The threshold being proven: ${challenge.threshold} base units.`,
      `The target application and the action it authorises.`,
      `The challenge identifier, and that it was consumed.`,
      `Your Limen subject identifier, a pseudonym scoped to this anonymizer.`,
      `That the pool withdrew the threshold to the anonymizer and credited it back.`,
      `The time the transaction landed.`,
    ],
    staysPrivate: [
      "Your total shielded balance.",
      "How much more than the threshold you hold.",
      "Which notes you spent, and their amounts.",
      "Your Starknet address, which the target never receives.",
      "Your unrelated shielded transfers and positions.",
      "Your viewing key and your signing key.",
    ],
    caveats: [
      "Deposits into and withdrawals out of the STRK20 pool are public by protocol design; only movement inside the pool is shielded.",
      "Timing correlation can link a shielding deposit to a later clearance. Shield well ahead of time.",
      "A distinctive threshold narrows the set of users it could have been.",
      "The threshold itself is intentionally disclosed to the verifier. That is the point of the product.",
      "Limen proves a bounded capital condition. It is not identity anonymity, and it is not proof of solvency.",
    ],
  };
}

export interface BuildClearanceOptions {
  readonly challenge: Challenge;
  readonly subject: string;
  readonly anonymizer: string;
  readonly noteRecipient: string;
  readonly provingBlockId: number;
  readonly poolFee: bigint;
  readonly tokenSymbol: string;
  /** Current unix seconds, for the freshness check. */
  readonly now?: number;
}

/**
 * Validates a challenge against the subject about to clear it and produces the plan.
 *
 * Freshness is checked here, immediately before signing, rather than when the
 * challenge was fetched: proving takes long enough that a challenge can expire in
 * between, and submitting then would burn a pool fee for a guaranteed revert.
 */
export function buildClearancePlan(options: BuildClearanceOptions): ClearancePlan {
  const { challenge, subject } = options;
  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (challenge.consumedBy !== null) throw new LimenError("CHALLENGE_CONSUMED");
  if (challenge.expiresAt <= now) throw new LimenError("CHALLENGE_EXPIRED");
  if (BigInt(challenge.subject) !== 0n && BigInt(challenge.subject) !== BigInt(subject)) {
    throw new LimenError("WRONG_SUBJECT");
  }
  if (challenge.threshold <= 0n) throw new LimenError("BELOW_THRESHOLD");

  return {
    challengeId: challenge.challengeId,
    subject: num.toHex(subject),
    token: challenge.token,
    withdrawAmount: challenge.threshold,
    anonymizer: num.toHex(options.anonymizer),
    target: challenge.target,
    noteRecipient: num.toHex(options.noteRecipient),
    provingBlockId: options.provingBlockId,
    poolFee: options.poolFee,
    disclosure: disclosureFor(challenge, options.tokenSymbol),
  };
}

/**
 * Selects notes covering exactly the plan's withdrawal.
 *
 * Notes are spent whole, so the selection has to cover the threshold and let the
 * remainder come back as change. A note is only spendable once it has matured, which
 * is a client-side rule the pool does not enforce and which otherwise surfaces as an
 * opaque `NOTE_NOT_FOUND` at proving time.
 */
export const NOTE_MATURITY_BLOCKS = 10;

export interface SelectableNote {
  readonly amount: bigint;
  readonly created: number;
}

export function selectNotes<T extends SelectableNote>(
  notes: readonly T[],
  required: bigint,
  currentBlock: number
): T[] {
  const mature = notes.filter((note) => currentBlock - note.created >= NOTE_MATURITY_BLOCKS);
  const total = mature.reduce((sum, note) => sum + note.amount, 0n);

  if (total < required) {
    const immatureTotal = notes
      .filter((note) => currentBlock - note.created < NOTE_MATURITY_BLOCKS)
      .reduce((sum, note) => sum + note.amount, 0n);
    throw new LimenError(
      immatureTotal + total >= required ? "NOTES_IMMATURE" : "INSUFFICIENT_SHIELDED_BALANCE",
      `mature ${total}, required ${required}`
    );
  }

  // Largest first, so the fewest notes are consumed and the fewest nullifiers are
  // published. Spending many small notes to make up a threshold is itself a signal.
  const ordered = [...mature].sort((left, right) =>
    right.amount === left.amount ? 0 : right.amount > left.amount ? 1 : -1
  );
  const selected: T[] = [];
  let running = 0n;
  for (const note of ordered) {
    if (running >= required) break;
    selected.push(note);
    running += note.amount;
  }
  return selected;
}
