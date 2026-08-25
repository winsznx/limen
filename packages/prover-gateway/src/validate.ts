/**
 * Request validation, run before anything expensive happens.
 *
 * The prover will reject a malformed transaction itself, but only after booting a
 * container and starting work. Rejecting here keeps a bad payload from occupying the
 * one proving slot Limen has, which is the whole point of admission control.
 *
 * Nothing in this file logs or returns request content.
 */

export type ValidationResult =
  | {
      ok: true;
      params: { block_id: { block_number: number }; transaction: Record<string, unknown> };
      blockNumber: number;
    }
  | { ok: false; code: string; rpcCode: number; message: string; detail?: string };

/** Bounds a felt array so a hostile client cannot make the gateway allocate freely. */
const MAX_CALLDATA_FELTS = 100_000;
const MAX_SIGNATURE_FELTS = 64;

function invalid(code: string, detail: string): ValidationResult {
  return { ok: false, code, rpcCode: 1000, message: "Invalid transaction input", detail };
}

function isFelt(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value);
}

function isFeltArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(isFelt);
}

export function validateProveParams(
  params: unknown,
  options: { allowNonZeroFeeFields?: boolean } = {}
): ValidationResult {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return invalid("params_shape", "params must be an object with block_id and transaction");
  }

  const { block_id: blockId, transaction } = params as Record<string, unknown>;

  if (
    blockId === null ||
    typeof blockId !== "object" ||
    typeof (blockId as Record<string, unknown>).block_number !== "number"
  ) {
    // "latest" and "pending" are refused deliberately. A proof must be anchored to a
    // settled block, both because the prover rejects pending blocks and because
    // proving at the chain head risks an L2 reorg invalidating the proof.
    return invalid("block_id", "block_id must be {block_number: <finalized block>}");
  }

  const blockNumber = (blockId as { block_number: number }).block_number;
  if (!Number.isInteger(blockNumber) || blockNumber < 0) {
    return invalid("block_number", "block_number must be a non-negative integer");
  }

  if (transaction === null || typeof transaction !== "object" || Array.isArray(transaction)) {
    return invalid("transaction_shape", "transaction must be an object");
  }

  const tx = transaction as Record<string, unknown>;

  if (tx.type !== "INVOKE") {
    return {
      ok: false,
      code: "tx_type",
      rpcCode: 61,
      message: "The transaction version is not supported",
      detail: "Only Invoke V3 transactions can be proven",
    };
  }
  if (tx.version !== "0x3") {
    return {
      ok: false,
      code: "tx_version",
      rpcCode: 61,
      message: "The transaction version is not supported",
      detail: "Only version 0x3 is supported",
    };
  }

  if (!isFelt(tx.sender_address)) return invalid("sender_address", "sender_address must be a felt");
  if (!isFelt(tx.nonce)) return invalid("nonce", "nonce must be a felt");
  if (!isFeltArray(tx.calldata, MAX_CALLDATA_FELTS)) {
    return invalid("calldata", "calldata must be an array of felts within the size bound");
  }
  if (!isFeltArray(tx.signature, MAX_SIGNATURE_FELTS)) {
    return invalid("signature", "signature must be an array of felts within the size bound");
  }

  // The prover charges no fee, so non-zero prices are normally a client bug that
  // would waste a proving slot. Replaying an already-signed mainnet transaction is
  // the one legitimate exception: rewriting its fee fields would change its hash.
  if (!options.allowNonZeroFeeFields && tx.tip !== undefined && tx.tip !== "0x0") {
    return invalid("tip", "tip must be 0x0; proving is client-side and charges no fee");
  }
  const bounds = tx.resource_bounds;
  if (!options.allowNonZeroFeeFields && bounds !== null && typeof bounds === "object") {
    for (const [name, bound] of Object.entries(bounds as Record<string, unknown>)) {
      const price = (bound as Record<string, unknown>)?.max_price_per_unit;
      if (price !== undefined && price !== "0x0") {
        return invalid("resource_bounds", `${name}.max_price_per_unit must be 0x0`);
      }
    }
  }

  // These are outputs, not inputs. Accepting them would let a client smuggle a
  // fabricated proof through a gateway that echoed its request.
  if ("proof" in tx || "proof_facts" in tx) {
    return invalid("output_fields", "proof and proof_facts must not be present in a request");
  }

  return {
    ok: true,
    params: { block_id: { block_number: blockNumber }, transaction: tx },
    blockNumber,
  };
}
