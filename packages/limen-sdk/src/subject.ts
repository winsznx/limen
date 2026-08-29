import { hash, num, shortString } from "starknet";
import { IDENTITY_KEY_TAG } from "@limenlabs/protocol-config";

/**
 * Derives a Limen subject identifier, which is the STRK20 pool's identity key for
 * (user, anonymizer):
 *
 *     poseidon(IDENTITY_KEY_TAG, user_addr, user_private_key, anonymizer)
 *
 * The pool computes this itself inside the proof and hands it to `privacy_compute`, so
 * a subject presented on chain is unforgeable. This function reproduces it locally for
 * clients that hold the key, so a user can tell a verifier who to bind a challenge to
 * before ever touching the chain.
 *
 * The private viewing key is used to compute a hash and is never stored, logged, or
 * transmitted by this function. Callers must keep it out of anything persistent. See
 * SECURITY.md.
 *
 * A dapp built on the Wallet API cannot call this, because it never sees the user's
 * viewing key. Those integrations use bearer challenges instead (DECISIONS.md D-010).
 */
export function deriveSubject(
  userAddress: string,
  userPrivateViewingKey: bigint,
  limenAddress: string
): string {
  if (userPrivateViewingKey <= 0n) {
    throw new Error("The viewing key must be a positive bigint, not a hex string");
  }
  return num.toHex(
    hash.computePoseidonHashOnElements([
      shortString.encodeShortString(IDENTITY_KEY_TAG),
      num.toHex(userAddress),
      num.toHex(userPrivateViewingKey),
      num.toHex(limenAddress),
    ])
  );
}

/**
 * A short, stable rendering of a subject for display. Subjects are pseudonyms, but
 * they are still identifiers, so the UI shows an abbreviation rather than encouraging
 * anyone to copy the full value around.
 */
export function formatSubject(subject: string): string {
  const padded = num.toHex(subject).slice(2).padStart(64, "0");
  return `limen:${padded.slice(0, 6)}…${padded.slice(-4)}`;
}
