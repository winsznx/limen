/**
 * The canonical Limen mainnet clearance.
 *
 *   spend private notes → withdraw exactly the threshold to the Limen Anonymizer
 *   → the bound Capital Gate action executes → the threshold returns to a shielded
 *   open note, all in one atomic transaction, proven by Limen's own prover.
 *
 * Two details are load-bearing and easy to get wrong:
 *
 *   - The proof must be anchored to a settled block. Proving at the head risks a reorg
 *     invalidating it between generation and submission, and the pool rejects proofs
 *     older than `proof_validity_blocks` anyway.
 *   - The SDK's proving client sends no Authorization header, and the Limen gateway
 *     requires a bearer token. Rather than weaken the gateway — it would otherwise be
 *     an open proving oracle — a loopback proxy adds the header. The token never
 *     leaves this process.
 *
 *   node --experimental-strip-types scripts/mainnet-clearance.ts
 */
import { Account, RpcProvider, num, shortString, constants } from "starknet";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createPrivateTransfers, Open } from "../.vendor/starknet-privacy/sdk/dist/index.js";
import { ContractDiscoveryProvider } from "../.vendor/starknet-privacy/sdk/dist/internal/contract-discovery.js";
import type { InvokeCalldataBuilderArgs } from "../.vendor/starknet-privacy/sdk/dist/interfaces.js";
import { computeChallengeId, createPoolViews, deriveSubject, randomNonce } from "@limen/sdk";

const POOL = "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const ACTION = "REGISTER_ALLOCATION";
const PROVING_LAG = 10;

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

/** Loopback proxy that attaches the gateway bearer token. */
function startProxy(target: string, token: string): Promise<{ url: string; close: () => void }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      void fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: Buffer.concat(chunks).toString("utf8"),
        // A proof takes minutes on this tier; the default would abort mid-proof.
        signal: AbortSignal.timeout(1_200_000),
      })
        .then(async (upstream) => {
          const text = await upstream.text();
          response.writeHead(upstream.status, { "content-type": "application/json" });
          response.end(text);
        })
        .catch((error) => {
          response.writeHead(502, { "content-type": "application/json" });
          response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: String(error).slice(0, 200) } }));
        });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function main() {
  const rpcUrl = need("STARKNET_MAINNET_RPC_URL");
  const address = need("DEPLOYER_ADDRESS");
  const privateKey = need("DEPLOYER_PRIVATE_KEY");
  const viewingKey = BigInt(need("LIMEN_VIEWING_KEY"));
  const gatewayUrl = need("LIMEN_GATEWAY_URL");
  const gatewayToken = need("LIMEN_GATEWAY_TOKEN");

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  if (shortString.decodeShortString(await provider.getChainId()) !== "SN_MAIN") {
    throw new Error("refusing to run against a chain other than SN_MAIN");
  }

  const deployment = JSON.parse(readFileSync("evidence/mainnet/deployment.json", "utf8")) as {
    anonymizer: { address: string };
    capital_gate: { address: string };
  };
  const anonymizer = deployment.anonymizer.address;
  const gate = deployment.capital_gate.address;

  const account = new Account({ provider, address, signer: privateKey, cairoVersion: "1" });
  const views = createPoolViews(provider, POOL);

  // ---------------------------------------------------------------- inputs

  const discovery = new ContractDiscoveryProvider(views);
  const discovered = (await discovery.discoverNotes(BigInt(address), viewingKey, {
    tokens: [BigInt(STRK)],
  })) as { notes: { get: (token: bigint) => Array<{ amount: bigint }> | undefined } };
  const notes = discovered.notes.get(BigInt(STRK)) ?? [];
  if (notes.length === 0) throw new Error("no shielded STRK notes in the Limen account");

  // Spend a single note whole and make the threshold exactly its amount, so the pool's
  // balance sheet closes with no change note: UseNote(+T) − Withdraw(T) = 0.
  const note = notes.reduce((best, entry) => (entry.amount > best.amount ? entry : best));
  const threshold = BigInt(note.amount);

  const gateMin = BigInt(
    ((await provider.callContract({ contractAddress: gate, entrypoint: "get_min_amount", calldata: [] })))[0] ?? "0x0"
  );
  if (threshold < gateMin) {
    throw new Error(`note holds ${threshold}, gate requires ${gateMin}`);
  }

  console.log(`anonymizer   ${anonymizer}`);
  console.log(`capital gate ${gate}  (min ${Number(gateMin) / 1e18} STRK)`);
  console.log(`threshold    ${Number(threshold) / 1e18} STRK  (whole note, no change)`);

  // ---------------------------------------------------------------- challenge

  const chainId = num.toHex(await provider.getChainId());
  const subject = deriveSubject(address, viewingKey, anonymizer);
  const params = {
    token: STRK,
    threshold,
    target: gate,
    action: ACTION,
    subject,
    issuer: address,
    expiresAt: Math.floor(Date.now() / 1000) + 6 * 3600,
    nonce: randomNonce(),
  };
  const challengeId = computeChallengeId(chainId, anonymizer, params);

  // The contract must agree on the identifier before anything is spent.
  const onChainId = num.toHex(
    ((await provider.callContract({
      contractAddress: anonymizer,
      entrypoint: "compute_challenge_id",
      calldata: [
        STRK, num.toHex(threshold), gate, shortString.encodeShortString(ACTION),
        subject, address, num.toHex(params.expiresAt), params.nonce,
      ],
    })))[0] ?? "0x0"
  );
  if (BigInt(onChainId) !== BigInt(challengeId)) {
    throw new Error(`challenge id mismatch: sdk ${challengeId}, contract ${onChainId}`);
  }
  console.log(`subject      ${subject.slice(0, 22)}…  (bound, not bearer)`);
  console.log(`challenge    ${challengeId}`);

  const pendingPath = "evidence/mainnet/pending-challenge.json";
  const calldata = [
    STRK, num.toHex(threshold), gate, shortString.encodeShortString(ACTION),
    subject, address, num.toHex(params.expiresAt), params.nonce,
  ];

  // A challenge already open for this exact shape is reused: creating another costs gas
  // and leaves an unusable one behind.
  let challengeTx = "(reused)";
  let reusedId = challengeId;
  if (existsSync(pendingPath)) {
    const pending = JSON.parse(readFileSync(pendingPath, "utf8")) as {
      challengeId: string; tx: string; threshold: string; gate: string; subject: string;
    };
    const stillOpen = BigInt(
      ((await provider.callContract({
        contractAddress: anonymizer, entrypoint: "is_challenge_open",
        calldata: [pending.challengeId],
      })))[0] ?? "0x0"
    ) === 1n;
    if (stillOpen && pending.threshold === threshold.toString() &&
        BigInt(pending.gate) === BigInt(gate) && BigInt(pending.subject) === BigInt(subject)) {
      reusedId = pending.challengeId;
      challengeTx = pending.tx;
      console.log(`challenge    ${reusedId}  (reusing, still open)`);
    }
  }

  if (challengeTx === "(reused)") {
  const created = await account.execute(
    { contractAddress: anonymizer, entrypoint: "create_challenge", calldata },
    { tip: 0n }
  );
  await provider.waitForTransaction(created.transaction_hash);
  challengeTx = created.transaction_hash;
  console.log(`  created in ${created.transaction_hash}`);
  mkdirSync("evidence/mainnet", { recursive: true });
  writeFileSync(pendingPath, JSON.stringify({
    challengeId, tx: challengeTx, threshold: threshold.toString(), gate, subject,
  }, null, 2) + "\n");
  }

  // ---------------------------------------------------------------- clearance

  const proxy = await startProxy(gatewayUrl.replace(/\/$/, ""), gatewayToken);
  try {
    const transfers = createPrivateTransfers({
      account,
      viewingKeyProvider: { getViewingKey: () => Promise.resolve(viewingKey) },
      provingProvider: {
        url: proxy.url,
        chainId: constants.StarknetChainId.SN_MAIN,
        // The SDK defaults to 30s, which is well under a real proof on this tier.
        // Aborting mid-proof throws the work away and the retry pays for it again.
        requestTimeoutMs: 1_200_000,
        // Retries are the gateway's job; it classifies transient failures from the
        // prover's own RPC codes. Retrying here would stack two policies.
        retry: { maxRetries: 0 },
      },
      discoveryProvider: discovery,
      poolContractAddress: POOL,
    });

    // The transparent-state rule: everything the proof reads must already exist at the
    // proving base. `privacy_compute` reads the challenge, so proving before the base
    // catches up to the creation block fails with LIMEN_CHALLENGE_NOT_FOUND — the
    // challenge is genuinely absent at that block.
    const createdAt = (await provider.getTransactionReceipt(challengeTx)) as unknown as {
      block_number?: number;
    };
    const createdBlock = createdAt.block_number ?? 0;
    let provingBlockId = (await provider.getBlockNumber()) - PROVING_LAG;
    if (provingBlockId <= createdBlock) {
      const needed = createdBlock + PROVING_LAG + 1;
      console.log(`\nchallenge landed in block ${createdBlock}; waiting for head ${needed} …`);
      while ((await provider.getBlockNumber()) < needed) {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
      provingBlockId = (await provider.getBlockNumber()) - PROVING_LAG;
    }
    console.log(`\nproving against block ${provingBlockId} (challenge at ${createdBlock}) …`);
    const startedAt = Date.now();

    const result = await transfers
      .build({ autoSetup: true })
      .with(STRK, (token) =>
        token
          .inputs(note as never)
          // Exactly the threshold to the anonymizer, and an open note for the return.
          .withdraw({ recipient: anonymizer, amount: threshold })
          .transfer({ recipient: address, amount: Open })
      )
      .computeAndInvoke(({ openNotes }: InvokeCalldataBuilderArgs) => {
        // The note the pool will credit the returned capital into. Its id is the only
        // thing the anonymizer needs in order to hand the capital back.
        const returnNote = openNotes[0];
        if (!returnNote) throw new Error("no open note was planned for the return");
        return {
          contractAddress: anonymizer,
          computeAdditionalData: [reusedId],
          invokeAdditionalData: [num.toHex(returnNote.noteId)],
        };
      })
      .execute({ provingBlockId });

    const provingMs = Date.now() - startedAt;
    console.log(`proof ready in ${(provingMs / 1000).toFixed(1)}s`);
    if (result.warnings.length) console.log(`warnings: ${JSON.stringify(result.warnings)}`);

    // Omit the proof keys entirely when there are no facts: empty arrays serialize an
    // invalid v3 transaction.
    const { proof } = result.callAndProof;
    const proofDetails = proof.proofFacts?.length
      ? { proofFacts: proof.proofFacts, proof: proof.data }
      : {};

    const submitted = await account.execute(result.callAndProof.call, { tip: 0n, ...proofDetails });
    console.log(`submitted ${submitted.transaction_hash}`);
    const receipt = (await provider.waitForTransaction(submitted.transaction_hash)) as unknown as {
      execution_status?: string;
      block_number?: number;
    };
    console.log(`  ${receipt.execution_status} in block ${receipt.block_number}`);

    mkdirSync("evidence/mainnet", { recursive: true });
    const path = "evidence/mainnet/clearances.json";
    const parsed = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as Partial<{ transactions: string[]; runs: unknown[] }>)
      : {};
    const existing = {
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
    existing.transactions.push(submitted.transaction_hash);
    existing.runs.push({
      at: new Date().toISOString(),
      challengeId: reusedId,
      subject,
      anonymizer,
      gate,
      thresholdFri: threshold.toString(),
      challengeTx,
      clearanceTx: submitted.transaction_hash,
      provingMs,
      provenBy: "limen-self-hosted",
      provingBlockId,
      executionStatus: receipt.execution_status,
      blockNumber: receipt.block_number,
    });
    writeFileSync(path, JSON.stringify(existing, null, 2) + "\n");
    console.log(`\nrecorded → ${path}`);
  } finally {
    proxy.close();
  }
}

void main().catch((error) => {
  console.error(`\n${error?.message ?? error}`);
  process.exit(1);
});
