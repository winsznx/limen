import { hash, num, shortString } from "starknet";
import { CHALLENGE_TAG } from "@limen/protocol-config";

/**
 * A capital-threshold challenge, as a verifier states it.
 *
 * Amounts are always base units. There is no float anywhere in this file, and no
 * conversion that could lose a unit.
 */
export interface ChallengeParams {
  /** ERC-20 whose capital satisfies the challenge. */
  token: string;
  /** Exact amount that must reach the anonymizer, in token base units. */
  threshold: bigint;
  /** Contract whose `limen_execute` runs on success. */
  target: string;
  /** Application-defined action identifier, as a short string or felt. */
  action: string;
  /**
   * Limen subject permitted to clear this challenge, or `0` for a bearer challenge
   * any subject may clear. See `deriveSubject`.
   */
  subject: string;
  /** Address that opens the challenge. Must be the caller of `create_challenge`. */
  issuer: string;
  /** Unix seconds. */
  expiresAt: number;
  /** Verifier-chosen uniqueness value. Reusing one collides and is rejected. */
  nonce: string;
}

/** A challenge as it exists on chain, plus its consumption state. */
export interface Challenge extends Omit<ChallengeParams, "nonce"> {
  challengeId: string;
  consumedBy: string | null;
  consumedAt: number | null;
  /** True when the challenge exists, is unconsumed, and has not expired. */
  open: boolean;
}

function toFelt(value: string | bigint | number): string {
  if (typeof value === "string" && !value.startsWith("0x")) {
    return shortString.encodeShortString(value);
  }
  return num.toHex(value);
}

/**
 * Derives the challenge identifier.
 *
 * Mirrors `limen_shared::challenge::compute_challenge_id`. The two derivations are
 * independent implementations of Poseidon, and both assert the same pinned vector, so
 * a change on either side turns exactly one suite red.
 */
export function computeChallengeId(
  chainId: string,
  limenAddress: string,
  params: ChallengeParams
): string {
  return num.toHex(
    hash.computePoseidonHashOnElements([
      shortString.encodeShortString(CHALLENGE_TAG),
      num.toHex(chainId),
      num.toHex(limenAddress),
      num.toHex(params.token),
      num.toHex(params.threshold),
      num.toHex(params.target),
      toFelt(params.action),
      num.toHex(params.subject),
      num.toHex(params.issuer),
      num.toHex(params.expiresAt),
      num.toHex(params.nonce),
    ])
  );
}

/** Calldata order for `create_challenge`, matching `ChallengeParams` in Cairo. */
export function challengeParamsCalldata(params: ChallengeParams): string[] {
  return [
    num.toHex(params.token),
    num.toHex(params.threshold),
    num.toHex(params.target),
    toFelt(params.action),
    num.toHex(params.subject),
    num.toHex(params.issuer),
    num.toHex(params.expiresAt),
    num.toHex(params.nonce),
  ];
}

/** A random 251-bit nonce. Verifiers should not reuse a nonce across challenges. */
export function randomNonce(): string {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  return num.toHex(BigInt(`0x${Buffer.from(bytes).toString("hex")}`) | 1n);
}

export const BEARER_SUBJECT = "0x0";

export function isBearer(subject: string): boolean {
  return BigInt(subject) === 0n;
}
