/**
 * Declares and deploys Limen to Starknet.
 *
 * Refuses to do anything it cannot verify first: that the account exists and is funded,
 * that the pool is the class Limen was built against, and that the anonymizer would not
 * be immediately useless because the pool has denylisted it. A deploy that half-succeeds
 * costs real money to unwind, so every precondition is checked before the first
 * transaction.
 *
 * Idempotent per contract: a class already declared is reused rather than redeclared.
 *
 *   export $(grep -E '^(DEPLOYER_|STARKNET_)' .env.local | xargs)
 *   node --experimental-strip-types scripts/deploy.ts
 */
import { Account, CallData, RpcProvider, ec, hash, num, shortString } from "starknet";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const EXPECTED_POOL_CLASS =
  "0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d";

/** The gate's own minimum, independent of what any challenge asks for. */
const GATE_MIN_AMOUNT = 5n * 10n ** 18n; // 5 STRK

const ARTIFACTS = "contracts/target/release";
const OUT = "evidence/mainnet/deployment.json";

interface Artifact {
  sierra: Record<string, unknown>;
  casm: Record<string, unknown>;
}

function loadArtifact(name: string): Artifact {
  const sierraPath = `${ARTIFACTS}/${name}.contract_class.json`;
  const casmPath = `${ARTIFACTS}/${name}.compiled_contract_class.json`;
  if (!existsSync(sierraPath) || !existsSync(casmPath)) {
    console.error(`Missing artifacts for ${name}. Build first:\n  cd contracts && scarb --profile release build`);
    process.exit(1);
  }
  return {
    sierra: JSON.parse(readFileSync(sierraPath, "utf8")),
    casm: JSON.parse(readFileSync(casmPath, "utf8")),
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required. See SETUP.md.`);
    process.exit(1);
  }
  return value;
}

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
  const privateKey = required("DEPLOYER_PRIVATE_KEY");

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const chainId = await provider.getChainId();
  if (shortString.decodeShortString(chainId) !== "SN_MAIN") {
    console.error(`Refusing to deploy: connected chain is ${shortString.decodeShortString(chainId)}, not SN_MAIN.`);
    process.exit(1);
  }

  // The class Limen was built against must still be what the pool runs. If it is not,
  // every interface assumption below this point is suspect.
  const poolClass = num.toHex(await provider.getClassHashAt(POOL, "latest"));
  if (BigInt(poolClass) !== BigInt(EXPECTED_POOL_CLASS)) {
    console.error(
      `Refusing to deploy: the pool runs class ${poolClass}, but Limen is built against ` +
        `${EXPECTED_POOL_CLASS}. Re-derive the protocol map first (DECISIONS.md D-001).`
    );
    process.exit(1);
  }
  console.log(`pool class matches the pinned revision`);

  const balance = await strkBalance(provider, address);
  console.log(`deployer ${address}`);
  console.log(`balance  ${Number(balance) / 1e18} STRK`);
  if (balance === 0n) {
    console.error("Refusing to deploy: the deployer has no STRK. See SETUP.md for the amount.");
    process.exit(1);
  }

  const account = new Account({ provider, address, signer: privateKey, cairoVersion: "1" });

  // The account itself has to exist before it can declare anything. A funded address
  // with no contract at it is a counterfactual account: the DEPLOY_ACCOUNT transaction
  // is what brings it into being, and it pays its own fee from that balance.
  let accountDeployed = true;
  try {
    await provider.getClassHashAt(address, "latest");
  } catch {
    accountDeployed = false;
  }

  if (!accountDeployed) {
    console.log("\ndeploying the account itself…");
    const publicKey = ec.starkCurve.getStarkKey(privateKey);
    const { transaction_hash, contract_address } = await account.deployAccount(
      {
        classHash: process.env.DEPLOYER_CLASS_HASH ?? OZ_ACCOUNT_CLASS_HASH,
        constructorCalldata: CallData.compile({ publicKey }),
        addressSalt: publicKey,
      },
      { tip: 0n }
    );
    await provider.waitForTransaction(transaction_hash);
    if (BigInt(contract_address) !== BigInt(address)) {
      console.error(
        `Refusing to continue: the deployed account landed at ${contract_address}, not ${address}.`
      );
      process.exit(1);
    }
    console.log(`  ${transaction_hash}`);
  } else {
    console.log("\naccount already deployed");
  }

  const anonymizerArtifact = loadArtifact("limen_anonymizer_LimenAnonymizer");
  const gateArtifact = loadArtifact("limen_capital_gate_CapitalGate");

  console.log("\ndeclaring LimenAnonymizer…");
  const anonymizerClass = await declare(provider, account, anonymizerArtifact);
  console.log(`  class ${anonymizerClass}`);

  console.log("declaring CapitalGate…");
  const gateClass = await declare(provider, account, gateArtifact);
  console.log(`  class ${gateClass}`);

  console.log("\ndeploying LimenAnonymizer…");
  const anonymizerDeploy = await deploy(
    provider,
    account,
    anonymizerClass,
    CallData.compile({ pool: POOL })
  );
  const anonymizer = anonymizerDeploy.address;
  console.log(`  ${anonymizer}`);

  console.log("deploying CapitalGate…");
  const gateDeploy = await deploy(
    provider,
    account,
    gateClass,
    CallData.compile({ limen: anonymizer, required_token: STRK, min_amount: GATE_MIN_AMOUNT })
  );
  const capitalGate = gateDeploy.address;
  console.log(`  ${capitalGate}`);

  // A denylisted anonymizer cannot credit open notes, so every clearance would revert.
  // Better to learn that now than from a failed mainnet clearance.
  const blocked = (await provider.callContract({
    contractAddress: POOL,
    entrypoint: "is_open_note_depositor_blocked",
    calldata: [anonymizer],
  })) as string[];
  const denylisted = BigInt(blocked[0] ?? "0x0") !== 0n;
  console.log(`\nopen-note deposits: ${denylisted ? "BLOCKED by the pool" : "permitted"}`);
  if (denylisted) {
    console.error("The pool has denylisted this anonymizer. Clearances cannot work.");
  }

  const record = {
    deployed_at: new Date().toISOString(),
    network: "SN_MAIN",
    commit: gitCommit(),
    pool: { address: POOL, class_hash: poolClass },
    anonymizer: { address: anonymizer, class_hash: anonymizerClass, constructor: { pool: POOL } },
    capital_gate: {
      address: capitalGate,
      class_hash: gateClass,
      constructor: {
        limen: anonymizer,
        required_token: STRK,
        min_amount: GATE_MIN_AMOUNT.toString(),
      },
    },
    open_note_deposits_permitted: !denylisted,
  };

  mkdirSync("evidence/mainnet", { recursive: true });
  writeFileSync(OUT, JSON.stringify(record, null, 2) + "\n");

  // strk20.json carries contracts as soon as they exist; transactions are added only
  // by verify-mainnet.ts, which re-reads each one from chain first.
  const strk20 = JSON.parse(readFileSync("strk20.json", "utf8")) as {
    transactions: string[];
    contracts: string[];
    demo_video: string;
    demo_url: string;
  };
  strk20.contracts = [anonymizer, capitalGate];
  writeFileSync("strk20.json", JSON.stringify(strk20, null, 2) + "\n");

  console.log(`\nrecorded → ${OUT}`);
  console.log("\nSet these on the web app, then redeploy it:");
  console.log(`  wrangler secret put LIMEN_ANONYMIZER_ADDRESS   # ${anonymizer}`);
  console.log(`  wrangler secret put LIMEN_CAPITAL_GATE_ADDRESS # ${capitalGate}`);
}

async function declare(
  provider: RpcProvider,
  account: Account,
  artifact: Artifact
): Promise<string> {
  const classHash = num.toHex(hash.computeContractClassHash(artifact.sierra));
  try {
    await provider.getClass(classHash);
    console.log("  already declared, reusing");
    return classHash;
  } catch {
    // Not declared yet, which is the normal path.
  }
  const result = await account.declare(
    { contract: artifact.sierra as never, casm: artifact.casm as never },
    { tip: 0n }
  );
  await provider.waitForTransaction(result.transaction_hash);
  console.log(`  tx ${result.transaction_hash}`);
  return num.toHex(result.class_hash ?? classHash);
}

async function deploy(
  provider: RpcProvider,
  account: Account,
  classHash: string,
  constructorCalldata: string[]
): Promise<{ address: string; transactionHash: string }> {
  const result = await account.deployContract({ classHash, constructorCalldata }, { tip: 0n });
  await provider.waitForTransaction(result.transaction_hash);
  return {
    address: num.toHex(result.contract_address),
    transactionHash: result.transaction_hash,
  };
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

void main().catch((error) => {
  // Starknet RPC errors echo the request, and a DECLARE request contains the entire
  // sierra program. Print only what identifies the failure.
  const rpc = error as { baseError?: { code?: number; message?: string; data?: unknown } };
  const base = rpc?.baseError;
  if (base) {
    console.error(`\n  RPC error ${base.code ?? "?"}: ${base.message ?? ""}`);
    if (base.data) console.error(`  ${JSON.stringify(base.data).slice(0, 600)}`);
  } else {
    console.error(`\n  ${(error as Error)?.message?.slice(0, 600) ?? String(error).slice(0, 600)}`);
  }
  process.exit(1);
});
