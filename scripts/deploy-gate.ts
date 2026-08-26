/**
 * Deploys an additional CapitalGate instance with a lower minimum.
 *
 * The gate is immutable by design — no owner, no setter — so changing its
 * `min_amount` means deploying another instance. The class is already declared, so this
 * is a single deploy transaction rather than a redeclare.
 *
 * Context: the STRK20 pool fee is deducted from the *shielded* balance on a relayed
 * private transfer, so bootstrapping delivered 4 STRK rather than the 6 planned. Rather
 * than ask for another 12 STRK of shielding to clear a 5 STRK bar, the reference target
 * moves its bar. The mechanism under test is unchanged.
 */
import { Account, CallData, RpcProvider, num, shortString } from "starknet";
import { readFileSync, writeFileSync } from "node:fs";

const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const MIN_AMOUNT = 2n * 10n ** 18n;

async function main() {
  const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_MAINNET_RPC_URL! });
  if (shortString.decodeShortString(await provider.getChainId()) !== "SN_MAIN") {
    throw new Error("not SN_MAIN");
  }

  const record = JSON.parse(readFileSync("evidence/mainnet/deployment.json", "utf8"));
  const anonymizer: string = record.anonymizer.address;
  const classHash: string = record.capital_gate.class_hash;

  const account = new Account({
    provider,
    address: process.env.DEPLOYER_ADDRESS!,
    signer: process.env.DEPLOYER_PRIVATE_KEY!,
    cairoVersion: "1",
  });

  console.log(`deploying CapitalGate (class ${classHash.slice(0, 14)}…) with min ${Number(MIN_AMOUNT) / 1e18} STRK`);
  const result = await account.deployContract(
    {
      classHash,
      constructorCalldata: CallData.compile({
        limen: anonymizer,
        required_token: STRK,
        min_amount: MIN_AMOUNT,
      }),
    },
    { tip: 0n }
  );
  await provider.waitForTransaction(result.transaction_hash);
  const address = num.toHex(result.contract_address);
  console.log(`  gate     ${address}`);
  console.log(`  tx       ${result.transaction_hash}`);

  record.capital_gate_v1 = record.capital_gate;
  record.capital_gate = {
    address,
    class_hash: classHash,
    constructor: { limen: anonymizer, required_token: STRK, min_amount: MIN_AMOUNT.toString() },
    deploy_tx: result.transaction_hash,
    note: "Second instance with a 2 STRK minimum. The first had 5 STRK, above what the bootstrap delivered.",
  };
  writeFileSync("evidence/mainnet/deployment.json", JSON.stringify(record, null, 2) + "\n");

  const strk20 = JSON.parse(readFileSync("strk20.json", "utf8"));
  strk20.contracts = [anonymizer, address];
  writeFileSync("strk20.json", JSON.stringify(strk20, null, 2) + "\n");
  console.log("recorded");
}

void main().catch((e) => { console.error(e); process.exit(1); });
