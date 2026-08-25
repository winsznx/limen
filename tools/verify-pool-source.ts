/**
 * Proves that the upstream revision Limen builds against is the code actually running
 * at the STRK20 mainnet pool, by compiling it and comparing class hashes.
 *
 * This is the root of Limen's protocol map: every interface assumption in the
 * contracts and SDK is read from this revision, so it matters that it is the deployed
 * one and not the monorepo's moving `main` branch.
 *
 * Requires `scripts/vendor-sdk.sh` to have run and `scarb` on PATH.
 *   scarb --profile release build -p privacy   (inside .vendor/starknet-privacy)
 *   node --experimental-strip-types tools/verify-pool-source.ts
 */
import { RpcProvider, hash, num } from "starknet";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const VENDOR = ".vendor/starknet-privacy";
const ARTIFACT = `${VENDOR}/target/release/privacy_Privacy.contract_class.json`;
const RPC = process.env.STARKNET_MAINNET_RPC_URL ?? "https://rpc.starknet.lava.build";

async function main() {
  if (!existsSync(ARTIFACT)) {
    console.log("building the pinned pool package…");
    execFileSync("scarb", ["--profile", "release", "build", "-p", "privacy"], {
      cwd: VENDOR,
      stdio: "inherit",
    });
  }

  const commit = execFileSync("git", ["-C", VENDOR, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const contractClass = JSON.parse(readFileSync(ARTIFACT, "utf8"));
  const computed = num.toHex(hash.computeContractClassHash(contractClass));

  const provider = new RpcProvider({ nodeUrl: RPC });
  const deployed = num.toHex(await provider.getClassHashAt(POOL, "latest"));
  const matches = BigInt(computed) === BigInt(deployed);

  const report = {
    verified_at: new Date().toISOString(),
    pool_address: POOL,
    upstream_commit: commit,
    upstream_tag: "CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08",
    class_hash_from_pinned_source: computed,
    class_hash_deployed_on_mainnet: deployed,
    matches,
  };

  mkdirSync("evidence/mainnet", { recursive: true });
  writeFileSync("evidence/mainnet/pool-source-parity.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));

  if (!matches) {
    console.error(
      "\nThe mainnet pool no longer runs the revision Limen is built against. " +
        "Re-derive the protocol map before trusting any interface assumption."
    );
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
