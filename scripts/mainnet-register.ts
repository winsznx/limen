/**
 * Registers the Limen account with the STRK20 pool, proven by the Limen Prover.
 *
 * This is the smallest transaction that exercises the whole self-hosted proving path
 * end to end against mainnet: the SDK compiles client actions, the Limen Prover
 * produces the STARK proof, and the pool verifies it on chain before applying anything.
 *
 * It carries no `Deposit` action, so `apply_actions` requires `screening: None` — which
 * is exactly why Limen can prove it without the screening credentials only the official
 * deployment holds (DECISIONS.md D-008).
 *
 * Registration is once per account per pool deployment; registering twice reverts.
 *
 *   set -a && . ./.env.local && set +a
 *   node --experimental-strip-types scripts/mainnet-register.ts
 */
import { Account, RpcProvider, constants, num, shortString } from "starknet";
import { createPrivateTransfers } from "../.vendor/starknet-privacy/sdk/dist/index.js";
import { ContractDiscoveryProvider } from "../.vendor/starknet-privacy/sdk/dist/internal/contract-discovery.js";
import { LimenProvingProvider, createPoolViews } from "@limen/sdk";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
/**
 * Allowance granted to the pool for its fee.
 *
 * The pool collects its fee with `transfer_from` against the submitting account, so a
 * bare balance is not enough — without an allowance every pool transaction reverts with
 * "Insufficient ERC20 allowance". Approving several transactions' worth at once avoids
 * paying gas for an approval before each one.
 */
const FEE_ALLOWANCE = 30n * 10n ** 18n;
/** Prove against a settled block: the inputs must already exist at the chosen base. */
const PROVING_BLOCK_LAG = 10;
const OUT = "evidence/mainnet/register.json";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  ${name} is required. See SETUP.md.\n`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const rpcUrl = required("STARKNET_MAINNET_RPC_URL");
  const address = required("DEPLOYER_ADDRESS");
  const privateKey = required("DEPLOYER_PRIVATE_KEY");
  const viewingKey = BigInt(required("LIMEN_VIEWING_KEY"));
  const gatewayUrl = required("LIMEN_GATEWAY_URL");
  const gatewayToken = required("LIMEN_GATEWAY_TOKEN");

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const chainId = shortString.decodeShortString(await provider.getChainId());
  if (chainId !== "SN_MAIN") {
    console.error(`Refusing to run against ${chainId}. Mainnet only.`);
    process.exit(1);
  }

  const account = new Account({ provider, address, signer: privateKey, cairoVersion: "1" });

  // Already registered? The pool publishes the public viewing key, so this is a read.
  const existing = (await provider.callContract({
    contractAddress: POOL,
    entrypoint: "get_public_key",
    calldata: [address],
  }));
  if (BigInt(existing[0] ?? "0x0") !== 0n) {
    console.log(`\n  Already registered. Public viewing key ${num.toHex(existing[0]!)}\n`);
    return;
  }

  // The pool pulls its fee from the caller, so it needs an allowance, not just a balance.
  const feeRaw = (await provider.callContract({
    contractAddress: POOL,
    entrypoint: "get_fee_amount",
    calldata: [],
  }));
  const poolFee = BigInt(feeRaw[0] ?? "0x0");

  const allowanceRaw = (await provider.callContract({
    contractAddress: STRK,
    entrypoint: "allowance",
    calldata: [address, POOL],
  }));
  const allowance = BigInt(allowanceRaw[0] ?? "0x0") + (BigInt(allowanceRaw[1] ?? "0x0") << 128n);

  console.log(`\n  pool fee        ${Number(poolFee) / 1e18} STRK`);
  console.log(`  allowance       ${Number(allowance) / 1e18} STRK`);

  if (allowance < poolFee) {
    console.log(`  approving       ${Number(FEE_ALLOWANCE) / 1e18} STRK to the pool…`);
    const approval = await account.execute(
      {
        contractAddress: STRK,
        entrypoint: "approve",
        calldata: [POOL, num.toHex(FEE_ALLOWANCE), "0x0"],
      },
      { tip: 0n }
    );
    await provider.waitForTransaction(approval.transaction_hash);
    console.log(`  approval tx     ${approval.transaction_hash}`);
  }

  const head = await provider.getBlockNumber();
  const provingBlockId = head - PROVING_BLOCK_LAG;
  console.log(`\nregistering ${address}`);
  console.log(`  head            ${head}`);
  console.log(`  proving base    ${provingBlockId}`);

  // Notes are discovered from the pool contract directly rather than from a discovery
  // service, so nothing about this account's activity leaves the client (D-014).
  const poolViews = createPoolViews(provider, POOL, provingBlockId);

  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: () => Promise.resolve(viewingKey) },
    provingProvider: new LimenProvingProvider(
      gatewayUrl.replace(/\/$/, ""),
      gatewayToken,
      constants.StarknetChainId.SN_MAIN,
      { nodeUrl: rpcUrl, poolAddress: POOL, idempotencyKey: `register-${address}-${provingBlockId}` }
    ) as never,
    discoveryProvider: new ContractDiscoveryProvider(poolViews),
    poolContractAddress: POOL,
  });

  console.log(`  proving…        (the Limen Prover, self-hosted)`);
  const startedAt = Date.now();
  const result = await transfers.build().register().execute({ provingBlockId });
  const provingMs = Date.now() - startedAt;
  console.log(`  proved in       ${(provingMs / 1000).toFixed(1)}s`);

  const { callAndProof } = result as {
    callAndProof: { call: unknown; proof: { proofFacts?: string[]; data: string } };
  };

  // Omit the proof keys entirely when there are no proof facts: passing empty arrays
  // serialises an invalid v3 transaction.
  const proofDetails = callAndProof.proof.proofFacts?.length
    ? { proofFacts: callAndProof.proof.proofFacts, proof: callAndProof.proof.data }
    : {};

  console.log(`  submitting…`);
  const submitted = await account.execute(callAndProof.call as never, {
    tip: 0n,
    ...proofDetails,
  });
  console.log(`  tx              ${submitted.transaction_hash}`);

  const receipt = (await provider.waitForTransaction(submitted.transaction_hash)) as unknown as {
    execution_status?: string;
    block_number?: number;
    revert_reason?: string;
  };
  console.log(`  status          ${receipt.execution_status}`);
  if (receipt.revert_reason) console.log(`  revert          ${receipt.revert_reason.slice(0, 200)}`);

  const record = {
    ran_at: new Date().toISOString(),
    network: "SN_MAIN",
    account: address,
    pool: POOL,
    transaction_hash: submitted.transaction_hash,
    block_number: receipt.block_number ?? null,
    execution_status: receipt.execution_status ?? null,
    proving: {
      provider: "Limen Prover (self-hosted)",
      gateway: gatewayUrl.replace(/\/\/[^@]*@/, "//"),
      duration_ms: provingMs,
      proving_block_id: provingBlockId,
      proof_facts: callAndProof.proof.proofFacts?.length ?? 0,
    },
  };
  mkdirSync("evidence/mainnet", { recursive: true });
  writeFileSync(OUT, JSON.stringify(record, null, 2) + "\n");

  // Record the hash for verify-mainnet.ts, which re-reads it from chain before
  // anything is published.
  const listPath = "evidence/mainnet/clearances.json";
  const list = existsSync(listPath)
    ? (JSON.parse(readFileSync(listPath, "utf8")) as { transactions: string[] })
    : { transactions: [] };
  if (!list.transactions.includes(submitted.transaction_hash)) {
    list.transactions.push(submitted.transaction_hash);
    writeFileSync(listPath, JSON.stringify(list, null, 2) + "\n");
  }

  console.log(`\n  recorded → ${OUT}\n`);
}

void main().catch((error) => {
  // Starknet RPC errors echo the whole request, which for a pool transaction is a wall
  // of calldata. Print only what identifies the failure.
  const rpc = error as { baseError?: { code?: number; message?: string; data?: unknown } };
  if (rpc?.baseError) {
    console.error(`\n  RPC ${rpc.baseError.code ?? "?"}: ${rpc.baseError.message ?? ""}`);
    if (rpc.baseError.data) {
      console.error(`  ${JSON.stringify(rpc.baseError.data).slice(0, 900)}`);
    }
  } else {
    console.error(`\n  ${(error as Error).message?.slice(0, 600) ?? String(error).slice(0, 600)}`);
  }
  console.error("");
  process.exit(1);
});
