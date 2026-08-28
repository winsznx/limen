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
import { RpcProvider } from "starknet";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

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

/**
 * Why a replay did not produce a proof.
 *
 * Only `prover-failure` says anything about reliability. The other two are deterministic
 * properties of replaying somebody else's transaction at a shifted block: they reproduce
 * on every run, so counting them as failures would understate the prover and hide the
 * cases that actually matter.
 */
type FailureKind = "replay-rejected" | "unsupported-syscall" | "prover-failure";

interface Sample {
  transactionHash: string;
  blockNumber: number;
  provingBlock: number;
  calldataFelts: number;
  outcome: "succeeded" | "failed";
  errorCode?: number;
  errorMessage?: string;
  errorDetail?: string;
  failureKind?: FailureKind;
  durationMs: number;
  queueWaitMs: number;
  proofBytes?: number;
  proofFacts?: number;
  deduplicated?: boolean;
}

/**
 * Classifies a failed replay from the prover's own error text.
 *
 * Pure and total, so `--reclassify` can rebuild the buckets of an existing report
 * without re-proving anything, and so the taxonomy is auditable against stored evidence
 * rather than being decided once at run time and lost.
 */
export function classifyFailure(text: string): FailureKind {
  // The replay never described a state the OS would accept, so proving never started.
  if (/Unexpected nonce/i.test(text)) return "replay-rejected";
  if (/`validate` entry point panicked/i.test(text)) return "replay-rejected";
  if (/Invalid state diff|Storage deletion not allowed/i.test(text)) return "replay-rejected";
  // A real capability limit of the prover's virtual mode rather than a flake: the same
  // transaction fails identically every time.
  if (/Unexpected syscall selector in virtual mode/i.test(text)) return "unsupported-syscall";
  return "prover-failure";
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
    // Only the first transaction from a given sender in a block can be replayed: a
    // later one carries a higher nonce than the account holds at block N-1, and the OS
    // rejects it with "Unexpected nonce". That is a property of the replay method, not
    // of the prover, so those are excluded rather than counted as failures.
    const sendersSeenInBlock = new Set<string>();
    for (const transaction of block.transactions) {
      if (found.length >= wanted) break;
      if (transaction.type !== "INVOKE" || transaction.version !== "0x3") continue;
      // Felts arrive as hex strings; anything else means an unexpected transaction shape.
      const sender =
        typeof transaction.sender_address === "string" ? transaction.sender_address : "";
      if (sendersSeenInBlock.has(sender)) continue;
      sendersSeenInBlock.add(sender);
      const calldata = transaction.calldata as string[] | undefined;
      // Keep the sample close to the shape the prover is built for. A large multicall
      // or a complex DeFi route produces a much bigger execution trace than a pool
      // transaction, which the prover rejects with "Not enough twiddles!", a statement
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
  } = raw;
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

/** The host these latencies describe. Wrong hardware here would misdescribe every number. */
const PROVER_HOST = {
  image: "registry.fly.io/limen-prover:limen-portable-v2",
  image_source_commit: "e6b6fd2e9932909107833579e5b6efd6c75fa0af",
  image_note:
    "A rebuild of the pinned upstream prover at the commit its own OCI labels name, compiled with the default TARGET_CPU. The published image is built for one microarchitecture and aborts with SIGILL elsewhere (CONTRIBUTIONS.md C-1).",
  host: "Fly.io Machines, ord",
  instance_type: "performance-4x",
  vcpu: 4,
  memory_gib: 32,
  max_concurrent_requests: 1,
  note: "Upstream recommends 48 vCPU / 96 GB for production throughput. These numbers describe this tier only and are not a STRK20 benchmark.",
};

/**
 * Reduces samples to the published counters.
 *
 * Reliability is reported over *provable* replays only. A replay the sequencer refused,
 * and one whose execution needs a syscall the prover's virtual mode does not implement,
 * both fail identically on every run: folding them into a success rate would measure the
 * sampling method rather than the prover.
 */
function summarise(samples: Sample[]) {
  const proved = samples.filter((sample) => sample.outcome === "succeeded");
  const of = (kind: FailureKind) => samples.filter((sample) => sample.failureKind === kind).length;
  const replayRejected = of("replay-rejected");
  const unsupported = of("unsupported-syscall");
  const provable = samples.length - replayRejected - unsupported;

  const durations = proved.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    durations.length
      ? durations[Math.min(durations.length - 1, Math.floor(fraction * durations.length))]
      : null;

  return {
    submitted: samples.length,
    replay_rejected: replayRejected,
    replay_rejected_note:
      "The sequencer refused the replayed transaction before proving began: a nonce the sender's account could not hold at the proving base, a validate entry point that panicked there, or a state diff that block could not produce. Properties of replaying somebody else's transaction, not of the prover.",
    unsupported_syscall: unsupported,
    unsupported_syscall_note:
      "Execution reached a syscall the prover's virtual mode does not implement (GetBlockHash). Deterministic and reproducible, so it bounds the provable workload rather than measuring reliability.",
    provable,
    proved: proved.length,
    prover_failures: of("prover-failure"),
    success_rate: provable > 0 ? `${((proved.length / provable) * 100).toFixed(1)}%` : "n/a",
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    min_ms: durations[0] ?? null,
    max_ms: durations[durations.length - 1] ?? null,
  };
}

/**
 * Rebuilds an existing report's counters from its own stored samples.
 *
 * The taxonomy is a pure function of error text captured at run time, so refining it must
 * not require spending another machine-hour of proving.
 *
 *   node --experimental-strip-types scripts/prover-benchmark.ts --reclassify <report.json>
 */
function reclassify(path: string): void {
  const report = JSON.parse(readFileSync(path, "utf8"));
  const samples: Sample[] = report.samples.map((sample: Sample) =>
    sample.outcome === "failed"
      ? {
          ...sample,
          failureKind: classifyFailure(`${sample.errorMessage ?? ""} ${sample.errorDetail ?? ""}`),
        }
      : sample
  );
  const rebuilt: Record<string, unknown> = {
    ...report,
    prover: PROVER_HOST,
    reclassified_at: new Date().toISOString(),
    ...summarise(samples),
    samples,
  };
  for (const stale of ["invalid_replays", "invalid_replay_note", "valid_attempts", "failed"]) {
    delete rebuilt[stale];
  }
  writeFileSync(path, JSON.stringify(rebuilt, null, 2) + "\n");
  const summary = summarise(samples);
  console.log(
    `${path}: ${summary.proved}/${summary.provable} provable proved (${summary.success_rate}), ` +
      `${summary.replay_rejected} replay-rejected, ${summary.unsupported_syscall} unsupported, ` +
      `${summary.prover_failures} prover failures`
  );
}

async function main() {
  const reclassifyTarget = process.argv.indexOf("--reclassify");
  if (reclassifyTarget !== -1) {
    const path = process.argv[reclassifyTarget + 1];
    if (!path) throw new Error("--reclassify needs the path to a report");
    reclassify(path);
    return;
  }

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
          failureKind: classifyFailure(`${payload.error.message} ${payload.error.data ?? ""}`),
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
        failureKind: classifyFailure((error as Error).message),
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

  const gatewayMetrics = await fetch(`${GATEWAY}/metrics`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  }).then((response) => response.json());

  const report = {
    ran_at: new Date().toISOString(),
    method:
      "Replayed real SN_MAIN Invoke V3 transactions against the block immediately before inclusion. No funds moved and nothing was submitted.",
    prover: PROVER_HOST,
    rpc_provider: RPC.replace(/\/[A-Za-z0-9_-]{20,}$/, "/<redacted>"),
    block_selection: "inclusion block minus one, finalized only",
    ...summarise(samples),
    gateway_metrics: gatewayMetrics,
    samples,
  };

  mkdirSync("evidence/benchmarks", { recursive: true });
  const path = `evidence/benchmarks/prover-replay-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `\n${report.proved}/${report.provable} provable replays proved (${report.success_rate}).` +
      ` ${report.replay_rejected} replay-rejected, ${report.unsupported_syscall} unsupported.` +
      ` p50 ${report.p50_ms}ms p95 ${report.p95_ms}ms → ${path}`
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
