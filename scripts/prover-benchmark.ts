/**
 * Proving reliability benchmark for the Limen Prover.
 *
 * Replays real Starknet mainnet Invoke V3 transactions against the block immediately
 * before they were included, which is a faithful proving workload and costs nothing:
 * no funds move, nothing is submitted, and the account's nonce at that base is exactly
 * the one the transaction used, so `__validate__` passes.
 *
 * This exists because "the prover works" is otherwise an assertion. Cloudflare's
 * largest container is 4 vCPU / 12 GiB and upstream recommends 48 vCPU / 96 GiB, so
 * the only honest way to state what Limen's proving tier can do is to measure it.
 *
 *   node --experimental-strip-types scripts/prover-benchmark.ts --samples 20
 *
 * Raw results land in evidence/benchmarks/.
 */
import { RpcProvider, num } from "starknet";
import { mkdirSync, writeFileSync } from "node:fs";

const RPC = process.env.STARKNET_MAINNET_RPC_URL ?? "https://rpc.starknet.lava.build";
const GATEWAY = process.env.LIMEN_GATEWAY_URL ?? "https://limen-prover-gateway.timjosh507.workers.dev";
const TOKEN = process.env.LIMEN_GATEWAY_TOKEN ?? "";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

const SAMPLES = Number(arg("samples", "10"));
/** Upper bound on replayed calldata size. See collectTransactions. */
const MAX_CALLDATA_FELTS = Number(arg("max-calldata", "24"));
const TIMEOUT_MS = Number(arg("timeout", "900000"));

interface Sample {
  transactionHash: string;
  blockNumber: number;
  provingBlock: number;
  calldataFelts: number;
  outcome: "succeeded" | "failed";
  errorCode?: number;
  errorMessage?: string;
  errorDetail?: string;
  durationMs: number;
  queueWaitMs: number;
  proofBytes?: number;
  proofFacts?: number;
  deduplicated?: boolean;
}

/** Collects Invoke V3 transactions from recent finalized blocks. */
async function collectTransactions(provider: RpcProvider, wanted: number) {
  const head = await provider.getBlockNumber();
  const found: Array<{ hash: string; blockNumber: number; transaction: Record<string, unknown> }> =
    [];
  // Stay well back from the head so every block is settled.
  for (let offset = 50; found.length < wanted && offset < 400; offset += 1) {
    const blockNumber = head - offset;
    const block = (await provider.getBlockWithTxs(blockNumber)) as unknown as {
      transactions: Array<Record<string, unknown>>;
    };
    for (const transaction of block.transactions) {
      if (found.length >= wanted) break;
      if (transaction.type !== "INVOKE" || transaction.version !== "0x3") continue;
      const calldata = transaction.calldata as string[] | undefined;
      // Keep the sample close to the shape the prover is built for. A large multicall
      // or a complex DeFi route produces a much bigger execution trace than a pool
      // transaction, which the prover rejects with "Not enough twiddles!" — a statement
      // about trace size, not about proving reliability.
      if (!calldata || calldata.length > MAX_CALLDATA_FELTS) continue;
      found.push({
        hash: transaction.transaction_hash as string,
        blockNumber,
        transaction,
      });
    }
  }
  return found;
}

/**
 * Prepares a historical transaction for replay.
 *
 * Only the response-only fields are removed. The fee fields are deliberately left
 * exactly as they were: a transaction's signature covers its hash, and the hash covers
 * the resource bounds and tip, so rewriting them to zero would make `__validate__`
 * reject the transaction with an invalid-signature panic rather than proving it.
 */
function toProvingTransaction(raw: Record<string, unknown>): Record<string, unknown> {
  const {
    transaction_hash: _hash,
    proof: _proof,
    proof_facts: _facts,
    ...rest
  } = raw as Record<string, unknown>;
  return rest;
}

async function prove(
  blockNumber: number,
  transaction: Record<string, unknown>,
  idempotencyKey: string
) {
  const startedAt = Date.now();
  const response = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_proveTransaction",
      params: { block_id: { block_number: blockNumber }, transaction },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload = (await response.json()) as {
    result?: { proof?: string; proof_facts?: string[] };
    error?: { code: number; message: string; data?: string };
  };
  return {
    payload,
    durationMs: Date.now() - startedAt,
    deduplicated: response.headers.get("x-limen-deduplicated") === "true",
  };
}

async function main() {
  if (!TOKEN) throw new Error("LIMEN_GATEWAY_TOKEN is required");

  const provider = new RpcProvider({ nodeUrl: RPC });
  console.log(`collecting ${SAMPLES} mainnet Invoke V3 transactions…`);
  const transactions = await collectTransactions(provider, SAMPLES);
  console.log(`collected ${transactions.length}`);

  const samples: Sample[] = [];
  for (const [index, entry] of transactions.entries()) {
    const provingBlock = entry.blockNumber - 1;
    const transaction = toProvingTransaction(entry.transaction);
    const calldataFelts = (entry.transaction.calldata as string[] | undefined)?.length ?? 0;
    const queueStart = Date.now();

    process.stdout.write(
      `[${index + 1}/${transactions.length}] ${entry.hash.slice(0, 12)}… block ${provingBlock} `
    );

    try {
      const { payload, durationMs, deduplicated } = await prove(
        provingBlock,
        transaction,
        `bench-${entry.hash}`
      );
      if (payload.error) {
        samples.push({
          transactionHash: entry.hash,
          blockNumber: entry.blockNumber,
          provingBlock,
          calldataFelts,
          outcome: "failed",
          errorCode: payload.error.code,
          errorMessage: payload.error.message.slice(0, 200),
          errorDetail: payload.error.data?.slice(0, 600),
          durationMs,
          queueWaitMs: 0,
        });
        console.log(
          `failed (${payload.error.code}) in ${(durationMs / 1000).toFixed(1)}s: ${(payload.error.data ?? payload.error.message).slice(0, 220)}`
        );
      } else {
        const proofBytes = payload.result?.proof ? Math.floor(payload.result.proof.length * 0.75) : 0;
        samples.push({
          transactionHash: entry.hash,
          blockNumber: entry.blockNumber,
          provingBlock,
          calldataFelts,
          outcome: "succeeded",
          durationMs,
          queueWaitMs: Date.now() - queueStart - durationMs,
          proofBytes,
          proofFacts: payload.result?.proof_facts?.length ?? 0,
          deduplicated,
        });
        console.log(
          `proved in ${(durationMs / 1000).toFixed(1)}s, ${(proofBytes / 1024).toFixed(0)} KiB`
        );
      }
    } catch (error) {
      samples.push({
        transactionHash: entry.hash,
        blockNumber: entry.blockNumber,
        provingBlock,
        calldataFelts,
        outcome: "failed",
        errorMessage: (error as Error).message.slice(0, 200),
        durationMs: Date.now() - queueStart,
        queueWaitMs: 0,
      });
      console.log(`error: ${(error as Error).message.slice(0, 80)}`);
    }
  }

  const succeeded = samples.filter((sample) => sample.outcome === "succeeded");
  const durations = succeeded.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    durations.length ? durations[Math.min(durations.length - 1, Math.floor(fraction * durations.length))] : null;

  const gatewayMetrics = await fetch(`${GATEWAY}/metrics`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  }).then((response) => response.json());

  const report = {
    ran_at: new Date().toISOString(),
    method:
      "Replayed real SN_MAIN Invoke V3 transactions against the block immediately before inclusion. No funds moved and nothing was submitted.",
    prover: {
      image:
        "ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2@sha256:a62e7764e034ea25d84d4a235f1f683f7c5f03f88f6646a744599171bf5ca58c",
      host: "Cloudflare Containers",
      instance_type: "standard-4",
      vcpu: 4,
      memory_gib: 12,
      max_concurrent_requests: 1,
      note: "Upstream recommends 48 vCPU / 96 GB for production throughput. These numbers describe this tier only and are not a STRK20 benchmark.",
    },
    rpc_provider: RPC.replace(/\/[A-Za-z0-9_-]{20,}$/, "/<redacted>"),
    block_selection: "inclusion block minus one, finalized only",
    submitted: samples.length,
    succeeded: succeeded.length,
    failed: samples.length - succeeded.length,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    min_ms: durations[0] ?? null,
    max_ms: durations[durations.length - 1] ?? null,
    gateway_metrics: gatewayMetrics,
    samples,
  };

  mkdirSync("evidence/benchmarks", { recursive: true });
  const path = `evidence/benchmarks/prover-replay-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `\n${succeeded.length}/${samples.length} proved. p50 ${report.p50_ms}ms p95 ${report.p95_ms}ms → ${path}`
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
