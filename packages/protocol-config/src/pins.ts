/**
 * Exact upstream revisions Limen is built against.
 *
 * These are not decorative. `tools/verify-pool-source.ts` compiles POOL_SOURCE_COMMIT
 * and asserts it produces POOL_CLASS_HASH_MAINNET, which is the class actually
 * deployed at the pool. If that check fails, every protocol assumption below it is
 * suspect and CI stops.
 */
export const UPSTREAM_PINS = {
  /** starkware-libs/starknet-privacy, tag CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08. */
  poolSourceCommit: "74841caf0466d122117945e28ed983e2864c8fc1",
  poolSourceTag: "CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08",
  poolClassHashMainnet: "0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d",
  poolVersionMainnet: "2.0",
  /** SDK version inside that revision. */
  privacySdkVersion: "0.14.3-rc.2",
  /** Transaction prover image the Limen Prover runs. */
  proverImage: "ghcr.io/starkware-libs/starknet-privacy/transaction-prover",
  proverImageTag: "PRIVACY-0.14.3-RC.2",
  proverImageDigest:
    "sha256:a2f71d7139069fa566c4f44bdd66b79cac992c0cbc20ddf0af3a3558c6cabd64",
  /** Starknet JSON-RPC spec the prover requires of its node. */
  requiredRpcSpec: "0.10",
} as const;

/** Entry-point selectors the pool uses when it calls an anonymizer. */
export const POOL_SELECTORS = {
  privacyInvoke: "0x402925cce9218828b3ac9a72ac249103f8448a1e1d73c3efaf5da992625043",
  privacyInvokeWithComputation:
    "0x0d7dcfbab5157247251535943d20090fb50187f80535f739fbacc8febab767",
  privacyCompute: "0x3c4448a75b7a87893c55b626c211bff463d0673333047c3f3fd2996cc54db46",
} as const;

/** Domain-separation tag the pool uses to derive a subject's identity key. */
export const IDENTITY_KEY_TAG = "IDENTITY_KEY_TAG:V1";

/** Domain-separation tag Limen uses to derive a challenge identifier. */
export const CHALLENGE_TAG = "LIMEN_CHALLENGE:V1";
