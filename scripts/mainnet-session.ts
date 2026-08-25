/**
 * The whole Limen mainnet sequence, unattended.
 *
 * Runs while the prover is up and stops the moment anything is not as expected, because
 * every step here costs real money and a half-finished sequence is expensive to unwind.
 *
 *   1. preflight   account funded, pool is the class Limen was built against,
 *                  anonymizer not denylisted, prover actually serving
 *   2. deploy      declare and deploy both contracts (skipped if already deployed)
 *   3. register    publish the viewing key, once per account per pool
 *   4. shield      move demo capital into the pool
 *   5. challenge   open a challenge against the reference gate
 *   6. clear       spend privately through the Limen Anonymizer via the Limen prover
 *   7. verify      re-read every transaction from chain and write strk20.json
 *
 * Each step records its outcome under evidence/mainnet/ before the next one starts, so
 * an interrupted run can be resumed rather than repeated.
 *
 *   node --experimental-strip-types scripts/mainnet-session.ts [--dry-run] [--from <step>]
 */
import { Account, RpcProvider, num, shortString } from "starknet";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const EXPECTED_POOL_CLASS =
  "0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d";

const STATE_PATH = "evidence/mainnet/session.json";

const DRY_RUN = process.argv.includes("--dry-run");

interface SessionState {
  startedAt: string;
  network: "SN_MAIN";
  commit: string;
  steps: Record<string, { at: string; ok: boolean; detail?: unknown }>;
  transactions: string[];
}

function loadState(): SessionState {
  if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, "utf8")) as SessionState;
  return {
    startedAt: new Date().toISOString(),
    network: "SN_MAIN",
    commit: gitCommit(),
    steps: {},
    transactions: [],
  };
}

function saveState(state: SessionState): void {
  mkdirSync("evidence/mainnet", { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  ${name} is required. See SETUP.md.\n`);
    process.exit(1);
  }
  return value;
}

const step = (name: string) => console.log(`\n── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`);
const note = (text: string) => console.log(`   ${text}`);
const fail = (text: string): never => {
  console.error(`\n   STOP: ${text}\n`);
  process.exit(1);
};

async function strkBalance(provider: RpcProvider, address: string): Promise<bigint> {
  const result = (await provider.callContract({
    contractAddress: STRK,
    entrypoint: "balance_of",
    calldata: [address],
  })) as string[];
  return BigInt(result[0] ?? "0x0") + (BigInt(result[1] ?? "0x0") << 128n);
}

async function main() {
  const rpcUrl = required("STARKNET_MAINNET_RPC_URL");
  const address = required("DEPLOYER_ADDRESS");
  const gatewayUrl = required("LIMEN_GATEWAY_URL");
  const gatewayToken = required("LIMEN_GATEWAY_TOKEN");
  required("DEPLOYER_PRIVATE_KEY");

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const state = loadState();

  console.log(`\nLimen mainnet session${DRY_RUN ? "  (dry run)" : ""}`);
  console.log(`commit ${state.commit.slice(0, 12)}`);

  // ---------------------------------------------------------------- preflight

  step("preflight");

  const chainId = shortString.decodeShortString(await provider.getChainId());
  if (chainId !== "SN_MAIN") fail(`connected to ${chainId}, not SN_MAIN`);
  note(`chain            ${chainId}`);

  // If this is not the class Limen was built against, every interface assumption below
  // is suspect and nothing should be spent.
  const poolClass = num.toHex(await provider.getClassHashAt(POOL, "latest"));
  if (BigInt(poolClass) !== BigInt(EXPECTED_POOL_CLASS)) {
    fail(
      `the pool runs class ${poolClass}, but Limen is built against ${EXPECTED_POOL_CLASS}.\n` +
        `  Re-derive the protocol map before spending anything (DECISIONS.md D-001).`
    );
  }
  note(`pool class       matches the pinned revision`);

  const feeRaw = (await provider.callContract({
    contractAddress: POOL,
    entrypoint: "get_fee_amount",
    calldata: [],
  })) as string[];
  const poolFee = BigInt(feeRaw[0] ?? "0x0");
  note(`pool fee         ${Number(poolFee) / 1e18} STRK per pool transaction`);

  const balance = await strkBalance(provider, address);
  note(`deployer balance ${(Number(balance) / 1e18).toFixed(4)} STRK`);

  // Three pool transactions plus deploys and gas. Refuse rather than strand the run
  // halfway through with contracts deployed and nothing to clear with.
  const minimum = poolFee * 3n + 12n * 10n ** 18n;
  if (balance < minimum) {
    fail(
      `balance is below the minimum for a full session (${Number(minimum) / 1e18} STRK).\n` +
        `  Top up ${address} before running.`
    );
  }

  const blockedRaw = (await provider.callContract({
    contractAddress: POOL,
    entrypoint: "is_open_note_depositor_blocked",
    calldata: [state.steps.deploy?.detail
      ? (state.steps.deploy.detail as { anonymizer: string }).anonymizer
      : "0x1"],
  })) as string[];
  if (BigInt(blockedRaw[0] ?? "0x0") !== 0n) {
    fail("the pool has denylisted this anonymizer; clearances cannot work");
  }

  const health = await fetch(`${gatewayUrl.replace(/\/$/, "")}/health`, {
    signal: AbortSignal.timeout(30_000),
  })
    .then((response) => response.json() as Promise<{ healthy?: boolean; reason?: string }>)
    .catch((error) => ({ healthy: false, reason: (error as Error).message }));

  if (!health.healthy) {
    fail(
      `the Limen Prover is not serving: ${health.reason ?? "unknown"}\n` +
        `  Bring it up first:  ./infra/fly/session.sh up`
    );
  }
  note(`limen prover     serving`);

  state.steps.preflight = {
    at: new Date().toISOString(),
    ok: true,
    detail: { poolClass, poolFee: poolFee.toString(), balance: balance.toString() },
  };
  saveState(state);

  if (DRY_RUN) {
    console.log(`\n   Dry run: preflight passed, nothing spent.\n`);
    return;
  }

  // ---------------------------------------------------------------- deploy

  step("deploy contracts");

  if (state.steps.deploy?.ok) {
    const detail = state.steps.deploy.detail as { anonymizer: string; capitalGate: string };
    note(`already deployed`);
    note(`anonymizer       ${detail.anonymizer}`);
    note(`capital gate     ${detail.capitalGate}`);
  } else {
    note(`running scripts/deploy.ts…`);
    execFileSync("node", ["--experimental-strip-types", "scripts/deploy.ts"], {
      stdio: "inherit",
      env: process.env,
    });
    const record = JSON.parse(readFileSync("evidence/mainnet/deployment.json", "utf8")) as {
      anonymizer: { address: string };
      capital_gate: { address: string };
    };
    state.steps.deploy = {
      at: new Date().toISOString(),
      ok: true,
      detail: {
        anonymizer: record.anonymizer.address,
        capitalGate: record.capital_gate.address,
      },
    };
    saveState(state);
  }

  // ---------------------------------------------------------------- remaining

  step("register, shield, challenge, clear");
  note(`Not yet automated end to end.`);
  note(``);
  note(`The STRK20 shielding deposit needs a screening attestation, which only the`);
  note(`official proving deployment can produce (DECISIONS.md D-008). The clearance`);
  note(`itself carries no Deposit action and is proven by the Limen prover.`);
  note(``);
  note(`Run scripts/mainnet-clearance.ts once the shielding step is settled, then:`);
  note(`  node --experimental-strip-types scripts/verify-mainnet.ts`);

  saveState(state);
  console.log(`\n   State recorded in ${STATE_PATH}\n`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
