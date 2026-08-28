/**
 * Independently verifies Limen's mainnet transactions, and is the only thing that
 * writes hashes into `strk20.json`.
 *
 * It trusts nothing Limen produced. Given a transaction hash it re-reads the receipt
 * from chain and reconstructs the entire mechanism from the events the pool and the
 * contracts emitted: the pool was touched, it invoked the Limen Anonymizer through the
 * compute path, a challenge was cleared, the bound target acted, and the capital came
 * back into a shielded open note.
 *
 * The check that matters most is `privateSourced`. The anonymizer cannot tell
 * pool-withdrawn capital from a public transfer, so this compares the pool's own
 * published `Withdrawal.amount` against the amount cleared. See DECISIONS.md D-007.
 *
 * A hash that fails any check is refused rather than downgraded, because a published
 * hash that does not verify is worse than no hash at all.
 *
 *   node --experimental-strip-types scripts/verify-mainnet.ts [0xhash ...]
 */
import { RpcProvider, hash, shortString } from "starknet";
import { verifyClearanceTransaction, type ClearanceVerification } from "@limen/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const RPC = process.env.STARKNET_MAINNET_RPC_URL ?? "https://rpc.starknet.lava.build";
const DEPLOYMENT = "evidence/mainnet/deployment.json";
const OUT = "evidence/mainnet/verification.json";

/** A transaction that touched the pool but is not a Limen clearance: setup, not evidence. */
interface PoolTouch {
  transactionHash: string;
  blockNumber: number | null;
  kind: "register" | "deposit" | "other-pool-touch";
  poolTouched: boolean;
}

function loadDeployment(): { anonymizer: string; capitalGate: string } | null {
  if (!existsSync(DEPLOYMENT)) return null;
  const record = JSON.parse(readFileSync(DEPLOYMENT, "utf8")) as {
    anonymizer?: { address?: string };
    capital_gate?: { address?: string };
  };
  const anonymizer = record.anonymizer?.address;
  const capitalGate = record.capital_gate?.address;
  return anonymizer && capitalGate ? { anonymizer, capitalGate } : null;
}

/**
 * Hashes to verify, and whether the run was scoped to specific ones.
 *
 * Naming hashes on the command line asks about those transactions. It must never
 * republish the manifest, because verifying one hash would then delete every other
 * published one, including on a machine that is only inspecting.
 */
function hashesToVerify(): { hashes: string[]; scoped: boolean } {
  const fromArgs = process.argv.slice(2).filter((arg) => /^0x[0-9a-fA-F]+$/.test(arg));
  if (fromArgs.length > 0) return { hashes: fromArgs, scoped: true };

  const collected = new Set<string>();
  for (const path of ["evidence/mainnet/clearances.json", "strk20.json"]) {
    if (!existsSync(path)) continue;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { transactions?: string[] };
    for (const hash of parsed.transactions ?? []) collected.add(hash);
  }
  return { hashes: [...collected], scoped: false };
}

/** Classifies a pool-touching transaction that is not a clearance. */
async function classifyPoolTouch(
  provider: RpcProvider,
  transactionHash: string
): Promise<PoolTouch> {
  const receipt = (await provider.getTransactionReceipt(transactionHash)) as unknown as {
    block_number?: number;
    events?: Array<{ from_address: string; keys: string[] }>;
  };
  const events = receipt.events ?? [];
  const fromPool = events.filter((event) => BigInt(event.from_address) === BigInt(POOL));

  const has = (name: string) => {
    const selector = BigInt(hash.getSelectorFromName(name));
    return fromPool.some((event) => BigInt(event.keys[0] ?? "0x0") === selector);
  };

  return {
    transactionHash,
    blockNumber: receipt.block_number ?? null,
    kind: has("ViewingKeySet") ? "register" : has("Deposit") ? "deposit" : "other-pool-touch",
    poolTouched: fromPool.length > 0,
  };
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });

  const chainId = await provider.getChainId();
  if (shortString.decodeShortString(chainId) !== "SN_MAIN") {
    console.error(`Refusing to verify against ${shortString.decodeShortString(chainId)}. Mainnet only.`);
    process.exit(1);
  }

  const deployment = loadDeployment();
  if (!deployment) {
    console.error(`No deployment record at ${DEPLOYMENT}. Run scripts/deploy.ts first.`);
    process.exit(1);
  }

  const { hashes, scoped } = hashesToVerify();
  if (hashes.length === 0) {
    console.log("Nothing to verify yet. Pass transaction hashes as arguments, or record");
    console.log("clearances in evidence/mainnet/clearances.json first.");
    process.exit(0);
  }

  console.log(`verifying ${hashes.length} transaction(s) against ${POOL}\n`);

  const clearances: ClearanceVerification[] = [];
  const touches: PoolTouch[] = [];

  for (const transactionHash of hashes) {
    try {
      const verification = await verifyClearanceTransaction(provider, transactionHash, {
        poolAddress: POOL,
        anonymizerAddress: deployment.anonymizer,
        targetAddress: deployment.capitalGate,
      });

      if (verification.checks.challengeCleared) {
        clearances.push(verification);
        report(verification);
      } else {
        // Not a clearance. Still evidence that the pool was touched, but it is
        // reported as what it is rather than counted as a clearance.
        const touch = await classifyPoolTouch(provider, transactionHash);
        touches.push(touch);
        console.log(`  ${transactionHash.slice(0, 14)}…  ${touch.kind}${touch.poolTouched ? "" : "  (pool NOT touched)"}`);
      }
    } catch (error) {
      console.log(`  ${transactionHash.slice(0, 14)}…  unreadable: ${(error as Error).message.slice(0, 80)}`);
    }
  }

  const fullyVerified = clearances.filter((entry) => entry.ok);
  // Only clearances go in the manifest. A declared transaction has to carry an event
  // from one of this project's own contracts to count as the project running on
  // mainnet, and a plain pool touch (the bootstrap transfer that funded this account)
  // does not. Those stay in the evidence report below as context rather than a claim.
  const qualifying = fullyVerified.map((entry) => entry.transactionHash);

  const report_ = {
    verified_at: new Date().toISOString(),
    network: "SN_MAIN",
    pool: POOL,
    anonymizer: deployment.anonymizer,
    capital_gate: deployment.capitalGate,
    method:
      "Each receipt is re-read from chain and the mechanism reconstructed from pool and contract events. Nothing is taken from Limen's own output.",
    clearances_verified: fullyVerified.length,
    clearances_failed: clearances.length - fullyVerified.length,
    other_pool_touches: touches.length,
    qualifying_transactions: qualifying,
    clearances,
    touches,
  };

  mkdirSync("evidence/mainnet", { recursive: true });
  writeFileSync(OUT, JSON.stringify(report_, null, 2) + "\n");

  console.log(`\n  clearances fully verified   ${fullyVerified.length}`);
  console.log(`  other pool-touching txs     ${touches.filter((t) => t.poolTouched).length}`);
  console.log(`  qualifying total            ${qualifying.length}`);

  const failed = clearances.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    console.log(`\n  ${failed.length} clearance(s) did not verify. Not writing strk20.json.`);
    for (const entry of failed) {
      console.log(`    ${entry.transactionHash}`);
      for (const problem of entry.problems) console.log(`      - ${problem}`);
    }
    writeFileSync(OUT, JSON.stringify(report_, null, 2) + "\n");
    process.exit(1);
  }

  if (scoped) {
    console.log(`\n  ${OUT}`);
    console.log("  Scoped to the hash(es) given, so strk20.json was left alone.");
    return;
  }

  // Only now, with every clearance independently reconstructed from chain, are hashes
  // published.
  const strk20 = JSON.parse(readFileSync("strk20.json", "utf8")) as Record<string, unknown>;
  strk20.transactions = qualifying;
  writeFileSync("strk20.json", JSON.stringify(strk20, null, 2) + "\n");

  console.log(`\n  strk20.json updated with ${qualifying.length} verified hash(es)`);
  console.log(`  ${OUT}`);

  if (qualifying.length < 3) {
    console.log(`\n  Note: the sprint requires at least three. Currently ${qualifying.length}.`);
  }
}

function report(verification: ClearanceVerification) {
  const { checks, observed } = verification;
  const mark = (ok: boolean) => (ok ? "ok  " : "FAIL");
  console.log(`  ${verification.transactionHash}`);
  console.log(`    ${mark(checks.succeeded)} executed successfully`);
  console.log(`    ${mark(checks.poolTouched)} STRK20 pool touched`);
  console.log(`    ${mark(checks.anonymizerInvoked)} anonymizer invoked via ${checks.invokeSelector ?? "?"}`);
  console.log(`    ${mark(checks.challengeCleared)} challenge cleared`);
  console.log(`    ${mark(checks.targetActionExecuted)} target action executed`);
  console.log(`    ${mark(checks.capitalReturnedShielded)} capital returned to a shielded note`);
  console.log(`    ${mark(checks.returnMatchesThreshold)} returned amount equals the threshold`);
  console.log(
    `    ${mark(checks.privateSourced)} funded entirely from private notes` +
      (observed.publiclyToppedUp && observed.publiclyToppedUp !== "0"
        ? ` (${observed.publiclyToppedUp} base units were public)`
        : "")
  );
  console.log("");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
