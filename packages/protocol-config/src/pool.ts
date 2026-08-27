import { RpcProvider, num } from "starknet";
import type { NetworkConfig } from "./networks.js";

/**
 * Live pool parameters. Every one of these is governance-settable, so Limen reads them
 * from chain at the moment it needs them rather than shipping a constant that quietly
 * goes stale. The pool fee in particular moved from 4 STRK to 6 STRK between the
 * upstream docs being written and this build.
 */
export interface PoolState {
  readonly version: string;
  readonly classHash: `0x${string}`;
  /** Charged in FRI (STRK base units) per `apply_actions`, taken from the caller. */
  readonly feeAmount: bigint;
  readonly feeCollector: `0x${string}`;
  /** How old a proof may be, in blocks, when `apply_actions` runs. */
  readonly proofValidityBlocks: number;
  readonly blockNumber: number;
  readonly readAt: string;
}

function feltToShortString(felt: string): string {
  const hex = num.toHex(felt).slice(2);
  return Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex").toString("ascii");
}

async function callSingle(
  provider: RpcProvider,
  contractAddress: string,
  entrypoint: string
): Promise<string> {
  const result = (await provider.callContract({
    contractAddress,
    entrypoint,
    calldata: [],
  }));
  const first = result[0];
  if (first === undefined) {
    throw new Error(`Pool view ${entrypoint} returned nothing`);
  }
  return first;
}

export async function readPoolState(
  provider: RpcProvider,
  config: NetworkConfig
): Promise<PoolState> {
  const pool = config.poolAddress;
  const [version, feeAmount, feeCollector, proofValidityBlocks, classHash, blockNumber] =
    await Promise.all([
      callSingle(provider, pool, "get_version"),
      callSingle(provider, pool, "get_fee_amount"),
      callSingle(provider, pool, "get_fee_collector"),
      callSingle(provider, pool, "get_proof_validity_blocks"),
      provider.getClassHashAt(pool, "latest"),
      provider.getBlockNumber(),
    ]);

  return {
    version: feltToShortString(version),
    classHash: num.toHex(classHash) as `0x${string}`,
    feeAmount: BigInt(feeAmount),
    feeCollector: num.toHex(feeCollector) as `0x${string}`,
    proofValidityBlocks: Number(BigInt(proofValidityBlocks)),
    blockNumber,
    readAt: new Date().toISOString(),
  };
}

/**
 * The pool can deny an open-note depositor, which would stop every clearance through
 * that anonymizer. Checked before a run rather than discovered as a revert.
 */
export async function isOpenNoteDepositorBlocked(
  provider: RpcProvider,
  config: NetworkConfig,
  depositor: string
): Promise<boolean> {
  const result = (await provider.callContract({
    contractAddress: config.poolAddress,
    entrypoint: "is_open_note_depositor_blocked",
    calldata: [depositor],
  }));
  return BigInt(result[0] ?? "0x0") !== 0n;
}

/**
 * Proving base for a transaction, per the SDK's transparent-state rule: prove against
 * a settled block so the inputs the proof reads already exist, and so an L2 reorg
 * cannot invalidate the proof between generation and submission.
 */
export const PROVING_BLOCK_LAG = 10;

export async function provingBlockId(provider: RpcProvider): Promise<number> {
  const head = await provider.getBlockNumber();
  const base = head - PROVING_BLOCK_LAG;
  if (base < 0) throw new Error(`Chain head ${head} is below the proving lag`);
  return base;
}
