/**
 * Generates the dedicated Limen deployment account and prints only what is safe to
 * share: network, address, class hash, and what it needs funding with.
 *
 * The private key is written to `.env.local`, which is gitignored, and is never
 * printed, logged, or returned. Run once; re-running refuses to overwrite an existing
 * key so a funded account cannot be orphaned by accident.
 *
 *   node --experimental-strip-types tools/new-account.ts
 */
import { CallData, ec, hash, num, stark, RpcProvider } from "starknet";
import { appendFileSync, existsSync, readFileSync, chmodSync, writeFileSync } from "node:fs";

/** OpenZeppelin account v3, declared on Starknet mainnet. */
const OZ_ACCOUNT_CLASS_HASH =
  "0x00e2eb8f5672af4e6a4e8a8f1b44989685e668489b0a25437733756c5a34a1d6";

const ENV_PATH = ".env.local";

function readEnvLocal(): Record<string, string> {
  if (!existsSync(ENV_PATH)) return {};
  const entries: Record<string, string> = {};
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) entries[match[1]] = match[2];
  }
  return entries;
}

async function main() {
  const existing = readEnvLocal();
  if (existing.DEPLOYER_PRIVATE_KEY) {
    console.log("An account already exists in .env.local. Refusing to overwrite it.");
    console.log(`address: ${existing.DEPLOYER_ADDRESS}`);
    return;
  }

  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);
  const constructorCalldata = CallData.compile({ publicKey });
  const address = hash.calculateContractAddressFromHash(
    publicKey,
    OZ_ACCOUNT_CLASS_HASH,
    constructorCalldata,
    0
  );

  if (!existsSync(ENV_PATH)) writeFileSync(ENV_PATH, "");
  chmodSync(ENV_PATH, 0o600);
  appendFileSync(
    ENV_PATH,
    [
      "",
      "# Limen dedicated deployment account. Generated locally; never commit this file.",
      `DEPLOYER_ADDRESS=${num.toHex(address)}`,
      `DEPLOYER_PUBLIC_KEY=${publicKey}`,
      `DEPLOYER_PRIVATE_KEY=${privateKey}`,
      `DEPLOYER_CLASS_HASH=${OZ_ACCOUNT_CLASS_HASH}`,
      "",
    ].join("\n")
  );
  chmodSync(ENV_PATH, 0o600);

  const rpc = process.env.STARKNET_MAINNET_RPC_URL ?? "https://rpc.starknet.lava.build";
  let classDeclared: boolean | string = "unknown";
  try {
    await new RpcProvider({ nodeUrl: rpc }).getClass(OZ_ACCOUNT_CLASS_HASH);
    classDeclared = true;
  } catch (error) {
    classDeclared = `not verified (${(error as Error).message.slice(0, 80)})`;
  }

  console.log(
    JSON.stringify(
      {
        network: "SN_MAIN (Starknet Mainnet)",
        address: num.toHex(address),
        account_class_hash: OZ_ACCOUNT_CLASS_HASH,
        account_class_declared_on_mainnet: classDeclared,
        private_key_location: `${ENV_PATH} (gitignored, chmod 600, never printed)`,
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
