/**
 * Dumps the ABI of the class actually deployed at the STRK20 mainnet pool.
 *
 * The repository's `main` branch is ahead of what mainnet runs, so the deployed
 * ABI, not the monorepo source, is the authority on which entry points,
 * actions and events Limen can rely on.
 */
import { RpcProvider, num } from "starknet";
import { writeFileSync, mkdirSync } from "node:fs";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const RPC =
  process.env.STARKNET_MAINNET_RPC_URL ?? "https://starknet-mainnet.public.blastapi.io/rpc/v0_9";

type AbiEntry = {
  type: string;
  name?: string;
  items?: AbiEntry[];
  variants?: Array<{ name: string; type: string }>;
  members?: Array<{ name: string; type: string }>;
  inputs?: Array<{ name: string; type: string }>;
  outputs?: Array<{ type: string }>;
  state_mutability?: string;
  kind?: string;
};

function flatten(abi: AbiEntry[]): AbiEntry[] {
  return abi.flatMap((entry) => (entry.items ? [entry, ...flatten(entry.items)] : [entry]));
}

async function main() {
  const provider = new RpcProvider({ nodeUrl: RPC });
  const classHash = num.toHex(await provider.getClassHashAt(POOL, "latest"));
  const contractClass = (await provider.getClass(classHash)) as unknown as { abi: AbiEntry[] };
  const abi = contractClass.abi;
  const flat = flatten(abi);

  const functions = flat
    .filter((entry) => entry.type === "function")
    .map((entry) => ({
      name: entry.name,
      state_mutability: entry.state_mutability,
      inputs: (entry.inputs ?? []).map((input) => `${input.name}: ${input.type}`),
      outputs: (entry.outputs ?? []).map((output) => output.type),
    }))
    .sort((left, right) => (left.name ?? "").localeCompare(right.name ?? ""));

  const enums = flat
    .filter((entry) => entry.type === "enum")
    .map((entry) => ({
      name: entry.name,
      variants: (entry.variants ?? []).map((variant) => `${variant.name}: ${variant.type}`),
    }));

  const structs = flat
    .filter((entry) => entry.type === "struct")
    .map((entry) => ({
      name: entry.name,
      members: (entry.members ?? []).map((member) => `${member.name}: ${member.type}`),
    }));

  const eventEnum = enums.find((entry) => entry.name?.endsWith("::Event"));

  const report = {
    probed_at: new Date().toISOString(),
    pool_address: POOL,
    class_hash: classHash,
    function_names: functions.map((entry) => entry.name),
    functions,
    client_action_variants:
      enums.find((entry) => entry.name?.includes("actions::ClientAction"))?.variants ?? null,
    server_action_variants:
      enums.find((entry) => entry.name?.includes("actions::ServerAction"))?.variants ?? null,
    open_note_screening_policy:
      enums.find((entry) => entry.name?.includes("OpenNoteScreeningPolicy"))?.variants ?? null,
    event_variants: eventEnum?.variants ?? null,
    structs: structs.filter((entry) =>
      /OpenNoteDeposit|ScreeningAttestation|InvokeExternalInput|ComputeAndInvokeInput|WithdrawInput|CreateOpenNoteInput|UseNoteInput/.test(
        entry.name ?? ""
      )
    ),
  };

  mkdirSync("evidence/mainnet", { recursive: true });
  writeFileSync("evidence/mainnet/pool-abi.json", JSON.stringify(report, null, 2) + "\n");
  writeFileSync("evidence/mainnet/pool-abi.raw.json", JSON.stringify(abi, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        class_hash: report.class_hash,
        function_names: report.function_names,
        client_action_variants: report.client_action_variants,
        server_action_variants: report.server_action_variants,
        open_note_screening_policy: report.open_note_screening_policy,
        event_variants: report.event_variants,
        structs: report.structs,
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
