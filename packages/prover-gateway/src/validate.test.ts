import { describe, expect, it } from "vitest";
import { validateProveParams } from "./validate.js";

/**
 * Validation runs before the prover is touched. Its job is to make sure a bad payload
 * can never occupy the single proving slot, which on this host is minutes of a whole
 * machine.
 */
const VALID_TX = {
  type: "INVOKE",
  version: "0x3",
  sender_address: "0x1234",
  nonce: "0x5",
  calldata: ["0x1", "0x2"],
  signature: ["0xabc", "0xdef"],
  tip: "0x0",
  resource_bounds: {
    l1_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
    l2_gas: { max_amount: "0x5f5e100", max_price_per_unit: "0x0" },
    l1_data_gas: { max_amount: "0x0", max_price_per_unit: "0x0" },
  },
};

const valid = { block_id: { block_number: 700_000 }, transaction: VALID_TX };

describe("proving request validation", () => {
  it("accepts a well-formed Invoke V3 against a finalized block", () => {
    const result = validateProveParams(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.blockNumber).toBe(700_000);
  });

  it("refuses a symbolic block id", () => {
    // The prover rejects pending blocks, and proving at the head risks an L2 reorg
    // invalidating the proof between generation and submission.
    for (const blockId of ["latest", "pending", { block_hash: "0xabc" }]) {
      expect(validateProveParams({ ...valid, block_id: blockId }).ok).toBe(false);
    }
  });

  it("refuses a negative or fractional block number", () => {
    expect(validateProveParams({ ...valid, block_id: { block_number: -1 } }).ok).toBe(false);
    expect(validateProveParams({ ...valid, block_id: { block_number: 1.5 } }).ok).toBe(false);
  });

  it("refuses anything that is not an Invoke V3", () => {
    for (const change of [{ type: "DECLARE" }, { type: "DEPLOY_ACCOUNT" }, { version: "0x1" }]) {
      const result = validateProveParams({
        ...valid,
        transaction: { ...VALID_TX, ...change },
      });
      expect(result.ok).toBe(false);
      // Code 61 is what the prover itself returns, so clients see one behaviour
      // whether the gateway or the prover caught it.
      if (!result.ok) expect(result.rpcCode).toBe(61);
    }
  });

  it("refuses malformed felts rather than passing them through", () => {
    for (const change of [
      { sender_address: "not-a-felt" },
      { nonce: "5" },
      { calldata: ["0xzz"] },
      { signature: "0xabc" },
      { calldata: "0x1" },
    ]) {
      expect(validateProveParams({ ...valid, transaction: { ...VALID_TX, ...change } }).ok).toBe(
        false
      );
    }
  });

  it("bounds calldata and signature length so a hostile client cannot force a large allocation", () => {
    const huge = Array.from({ length: 100_001 }, () => "0x1");
    expect(validateProveParams({ ...valid, transaction: { ...VALID_TX, calldata: huge } }).ok).toBe(
      false
    );
    const manySignatures = Array.from({ length: 65 }, () => "0x1");
    expect(
      validateProveParams({ ...valid, transaction: { ...VALID_TX, signature: manySignatures } }).ok
    ).toBe(false);
  });

  it("refuses a request that carries proof fields", () => {
    // These are outputs. Accepting them would let a client smuggle a fabricated proof
    // through any layer that echoed its request back.
    expect(
      validateProveParams({ ...valid, transaction: { ...VALID_TX, proof: "AAA" } }).ok
    ).toBe(false);
    expect(
      validateProveParams({ ...valid, transaction: { ...VALID_TX, proof_facts: ["0x1"] } }).ok
    ).toBe(false);
  });

  it("refuses non-zero fee fields by default", () => {
    const withTip = { ...VALID_TX, tip: "0x3" };
    expect(validateProveParams({ ...valid, transaction: withTip }).ok).toBe(false);

    const withPrice = {
      ...VALID_TX,
      resource_bounds: {
        ...VALID_TX.resource_bounds,
        l2_gas: { max_amount: "0x1", max_price_per_unit: "0x64" },
      },
    };
    expect(validateProveParams({ ...valid, transaction: withPrice }).ok).toBe(false);
  });

  it("allows non-zero fee fields when replaying a signed transaction", () => {
    // Rewriting the fee fields of an already-signed transaction changes its hash, so
    // the account's own __validate__ then rejects it. Limen's clearances are
    // unaffected: the pool's __validate__ requires zero fee fields regardless.
    const replayed = { ...VALID_TX, tip: "0x3" };
    expect(
      validateProveParams({ ...valid, transaction: replayed }, { allowNonZeroFeeFields: true }).ok
    ).toBe(true);
  });

  it("refuses a params object that is not an object", () => {
    for (const params of [null, undefined, [], "x", 5]) {
      expect(validateProveParams(params).ok).toBe(false);
    }
  });
});
