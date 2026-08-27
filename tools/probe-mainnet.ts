/**
 * Reads live Starknet Mainnet state for the STRK20 privacy pool.
 *
 * Every protocol constant Limen depends on is read from chain here rather than
 * hardcoded, and the raw output is committed as G1 evidence. Run with:
 *   node --experimental-strip-types tools/probe-mainnet.ts
 */
import { RpcProvider, hash, num } from "starknet";
import { writeFileSync, mkdirSync } from "node:fs";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

const RPC_CANDIDATES = [
  process.env.STARKNET_MAINNET_RPC_URL,
  "https://starknet-mainnet.public.blastapi.io/rpc/v0_9",
  "https://starknet-mainnet.public.blastapi.io/rpc/v0_8",
  "https://free-rpc.nethermind.io/mainnet-juno",
  "https://rpc.starknet.lava.build",
].filter((url): url is string => Boolean(url));

async function pickProvider(): Promise<{ provider: RpcProvider; url: string; spec: string }> {
  const failures: string[] = [];
  for (const url of RPC_CANDIDATES) {
    try {
      const provider = new RpcProvider({ nodeUrl: url });
      const spec = await provider.getSpecVersion();
      const chainId = await provider.getChainId();
      if (num.toHex(chainId) !== num.toHex(shortStringToFelt("SN_MAIN"))) {
        failures.push(`${url}: wrong chain ${chainId}`);
        continue;
      }
      return { provider, url, spec };
    } catch (error) {
      failures.push(`${url}: ${(error as Error).message.slice(0, 120)}`);
    }
  }
  throw new Error(`No usable Starknet mainnet RPC.\n${failures.join("\n")}`);
}

function shortStringToFelt(value: string): string {
  return "0x" + Buffer.from(value, "ascii").toString("hex");
}

/**
 * The single felt a pool view returned, or undefined if it answered with another shape.
 *
 * Every view read here is declared to return one felt. Surfacing undefined keeps a
 * surprising answer visible in the report rather than printing 0x0 as though the pool
 * had really said zero.
 */
function firstFelt(value: unknown): string | undefined {
  return Array.isArray(value) ? (value[0] as string | undefined) : undefined;
}

/**
 * A required field of an emitted event.
 *
 * The pool's event layouts are fixed, so a missing field means this probe is reading an
 * event it does not understand, and saying so beats reporting a derived value.
 */
function eventFelt(values: string[], index: number, what: string): string {
  const felt = values[index];
  if (felt === undefined) throw new Error(`event is missing ${what} at index ${index}`);
  return felt;
}

function feltToShortString(felt: string): string {
  const hex = num.toHex(felt).slice(2);
  const padded = hex.length % 2 ? "0" + hex : hex;
  return Buffer.from(padded, "hex").toString("ascii");
}

async function callView(
  provider: RpcProvider,
  entrypoint: string,
  calldata: string[] = []
): Promise<string[] | { error: string }> {
  try {
    return (await provider.callContract({
      contractAddress: POOL,
      entrypoint,
      calldata,
    }));
  } catch (error) {
    return { error: (error as Error).message.slice(0, 300) };
  }
}

const POLICY_NAMES = ["Required", "Exempt", "Delegated"];

/** Names a screening policy felt, keeping an unrecognised value visible rather than guessed. */
function policyName(felt: string): string {
  return POLICY_NAMES[Number(BigInt(felt))] ?? `unknown(${felt})`;
}

async function main() {
  const { provider, url, spec } = await pickProvider();
  const blockNumber = await provider.getBlockNumber();
  const classHash = await provider.getClassHashAt(POOL, "latest");

  const views: Record<string, unknown> = {};
  for (const entrypoint of [
    "get_version",
    "get_fee_amount",
    "get_fee_collector",
    "get_proof_validity_blocks",
    "get_screener_public_key",
    "get_auditor_public_key",
  ]) {
    views[entrypoint] = await callView(provider, entrypoint);
  }

  // The default screening policy for an unlisted depositor must be Required (index 0).
  const unlistedProbeAddress = "0x" + "1".padStart(63, "0") + "7";
  const unlistedPolicy = await callView(provider, "get_open_note_screening_policy", [
    unlistedProbeAddress,
  ]);

  // Which depositors has governance explicitly configured? These are the anonymizers
  // that can currently return open-note deposits on mainnet without an attestation.
  const policyEventKey = num.toHex(hash.getSelectorFromName("OpenNoteScreeningPolicySet"));
  const configuredPolicies: Array<{ depositor: string; policy: string; block: number | null }> =
    [];
  let continuationToken: string | undefined;
  let pages = 0;
  do {
    const page = await provider.getEvents({
      address: POOL,
      from_block: { block_number: 0 },
      to_block: "latest",
      keys: [[policyEventKey]],
      chunk_size: 100,
      continuation_token: continuationToken,
    });
    for (const event of page.events) {
      configuredPolicies.push({
        depositor: num.toHex(eventFelt(event.keys, 1, "depositor")),
        policy: policyName(eventFelt(event.data, 0, "policy")),
        block: event.block_number ?? null,
      });
    }
    continuationToken = page.continuation_token;
    pages += 1;
  } while (continuationToken && pages < 50);

  // Sample of real anonymizer traffic: who actually deposits into open notes today.
  const invokedKey = num.toHex(hash.getSelectorFromName("ExternalContractInvoked"));
  const recentInvokes = await provider.getEvents({
    address: POOL,
    from_block: { block_number: Math.max(0, blockNumber - 100_000) },
    to_block: "latest",
    keys: [[invokedKey]],
    chunk_size: 100,
  });
  const invokeTargets = new Map<string, { count: number; selectors: Set<string> }>();
  for (const event of recentInvokes.events) {
    const target = num.toHex(eventFelt(event.keys, 1, "target"));
    const entry = invokeTargets.get(target) ?? { count: 0, selectors: new Set<string>() };
    entry.count += 1;
    entry.selectors.add(num.toHex(eventFelt(event.keys, 2, "selector")));
    invokeTargets.set(target, entry);
  }

  const invokeSelector = num.toHex(hash.getSelectorFromName("privacy_invoke"));
  const computeInvokeSelector = num.toHex(
    hash.getSelectorFromName("privacy_invoke_with_computation")
  );

  // Policies actually in force for every address the pool has recently invoked.
  const invokeTargetPolicies: Array<{
    target: string;
    invocations: number;
    selectors: string[];
    policy: string;
  }> = [];
  for (const [target, info] of invokeTargets) {
    const policy = await callView(provider, "get_open_note_screening_policy", [target]);
    invokeTargetPolicies.push({
      target,
      invocations: info.count,
      selectors: [...info.selectors].map((selector) =>
        selector === invokeSelector
          ? "privacy_invoke"
          : selector === computeInvokeSelector
            ? "privacy_invoke_with_computation"
            : selector
      ),
      policy: (() => {
        const felt = firstFelt(policy);
        return felt === undefined ? JSON.stringify(policy) : policyName(felt);
      })(),
    });
  }
  invokeTargetPolicies.sort((left, right) => right.invocations - left.invocations);

  const versionFelt = firstFelt(views.get_version);
  const feeFelt = firstFelt(views.get_fee_amount);
  const collectorFelt = firstFelt(views.get_fee_collector);
  const validityFelt = firstFelt(views.get_proof_validity_blocks);
  const screenerFelt = firstFelt(views.get_screener_public_key);
  const auditorFelt = firstFelt(views.get_auditor_public_key);
  const unlistedFelt = firstFelt(unlistedPolicy);

  const report = {
    probed_at: new Date().toISOString(),
    rpc: { url: url.replace(/\/[A-Za-z0-9_-]{20,}$/, "/<redacted>"), spec_version: spec },
    chain_id: "SN_MAIN",
    block_number: blockNumber,
    pool: {
      address: POOL,
      class_hash: num.toHex(classHash),
      version: versionFelt ? feltToShortString(versionFelt) : views.get_version,
      fee_amount_fri: feeFelt ? BigInt(feeFelt).toString() : views.get_fee_amount,
      fee_amount_strk: feeFelt ? (Number(BigInt(feeFelt)) / 1e18).toString() : null,
      fee_collector: collectorFelt ? num.toHex(collectorFelt) : views.get_fee_collector,
      proof_validity_blocks: validityFelt
        ? Number(BigInt(validityFelt))
        : views.get_proof_validity_blocks,
      screener_public_key: screenerFelt
        ? num.toHex(screenerFelt)
        : views.get_screener_public_key,
      auditor_public_key: auditorFelt ? num.toHex(auditorFelt) : views.get_auditor_public_key,
    },
    open_note_screening: {
      unlisted_address_probe: unlistedProbeAddress,
      unlisted_address_policy: unlistedFelt ? policyName(unlistedFelt) : unlistedPolicy,
      governance_configured_depositors: configuredPolicies,
      recent_invoke_targets: invokeTargetPolicies,
      recent_invoke_window_blocks: Math.min(blockNumber, 100_000),
    },
    selectors: {
      privacy_invoke: invokeSelector,
      privacy_invoke_with_computation: computeInvokeSelector,
      privacy_compute: num.toHex(hash.getSelectorFromName("privacy_compute")),
    },
  };

  mkdirSync("evidence/mainnet", { recursive: true });
  writeFileSync("evidence/mainnet/pool-state.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
