import { RpcProvider, num } from "starknet";

/**
 * The STRK20 SDK's proving seam, pointed at the Limen Prover Gateway.
 *
 * The SDK ships `ProvingServiceProofProvider`, which speaks the same JSON-RPC but
 * cannot attach an `Authorization` header. The gateway requires a bearer token on every
 * proving request — without one it would be an open proving oracle, and proving is the
 * scarcest resource Limen operates. Rather than move the credential into a URL path to
 * fit the stock provider, Limen implements the interface and keeps the token in the
 * header where it belongs.
 *
 * The shape mirrors the SDK's own provider exactly, including how the server actions
 * are recovered from the L2-to-L1 message the pool emits.
 */

/** Nonce the pool expects on a proof invocation. Mirrors the SDK's constant. */
const PROOF_INVOCATION_NONCE = 0n;
/** Gas ceiling the OS enforces during proving. Fees are zero; only the limit matters. */
const DEFAULT_L2_GAS_MAX_AMOUNT = 100_000_000n;

export interface LimenProvingProviderOptions {
  /** RPC node used to read the pool's nonce. Requires `poolAddress`. */
  nodeUrl?: string;
  poolAddress?: string;
  /** Default proving base. Always a settled block number in practice. */
  blockIdentifier?: number | string;
  requestTimeoutMs?: number;
  /** Makes a retry safe: the gateway replays the original result. */
  idempotencyKey?: string;
}

interface ProveResult {
  proof: string;
  proof_facts?: string[];
  l2_to_l1_messages?: Array<{ from_address?: string; payload?: string[] }>;
  additional_data?: unknown;
}

export class LimenProvingProvider {
  private cachedNonce: bigint | null = null;
  private readonly rpc: RpcProvider | null;

  constructor(
    private readonly gatewayUrl: string,
    private readonly token: string,
    private readonly chainId: string,
    private readonly options: LimenProvingProviderOptions = {}
  ) {
    if (!token) throw new Error("LimenProvingProvider requires a gateway token");
    this.rpc = options.nodeUrl ? new RpcProvider({ nodeUrl: options.nodeUrl }) : null;
  }

  /** Clears the cached pool nonce. Call after an INVALID_NONCE before retrying. */
  invalidateNonceCache(): void {
    this.cachedNonce = null;
  }

  async getDefaultDetails(): Promise<Record<string, unknown>> {
    const base = {
      versions: ["0x3"],
      nonce: PROOF_INVOCATION_NONCE,
      skipValidate: true,
      resourceBounds: {
        l1_gas: { max_amount: 1n, max_price_per_unit: 0n },
        l2_gas: { max_amount: DEFAULT_L2_GAS_MAX_AMOUNT, max_price_per_unit: 0n },
        l1_data_gas: { max_amount: 1n, max_price_per_unit: 0n },
      },
      tip: 0n,
      paymasterData: [],
      accountDeploymentData: [],
      nonceDataAvailabilityMode: "L1",
      feeDataAvailabilityMode: "L1",
      version: "0x3",
      chainId: this.chainId,
    };

    if (!this.rpc || !this.options.poolAddress) return base;
    if (this.cachedNonce === null) {
      this.cachedNonce = BigInt(
        await this.rpc.getNonceForAddress(this.options.poolAddress, "latest")
      );
    }
    return { ...base, nonce: this.cachedNonce };
  }

  async prove(
    invocation: Record<string, unknown>,
    blockIdentifier?: number | string
  ): Promise<{
    data: string;
    output: string[];
    proofFacts: string[];
    additionalData?: unknown;
  }> {
    const block = blockIdentifier ?? this.options.blockIdentifier ?? "latest";
    const blockId = typeof block === "number" ? { block_number: block } : block;

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.token}`,
    };
    if (this.options.idempotencyKey) {
      headers["idempotency-key"] = this.options.idempotencyKey;
    }

    const response = await fetch(this.gatewayUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_proveTransaction",
        params: { block_id: blockId, transaction: invocation },
      }),
      signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 900_000),
    });

    const text = await response.text();
    let payload: { result?: ProveResult; error?: { code: number; message: string; data?: string } };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      // The gateway answers JSON for every outcome it knows about, so unparseable
      // means the connection died mid-proof rather than the prover rejecting anything.
      throw new Error(`Prover did not complete (HTTP ${response.status}): ${text.slice(0, 200)}`);
    }

    if (payload.error) {
      throw new Error(
        `Proving failed [${payload.error.code}]: ${payload.error.message}` +
          (payload.error.data ? ` — ${payload.error.data}` : "")
      );
    }
    const result = payload.result;
    if (!result?.proof) throw new Error("Prover returned no proof");

    // The pool emits the compiled server actions as an L2-to-L1 message. Its payload is
    // [class_hash, ...serialized_actions]; the consumer strips the prefix.
    const sender = num.toHex(invocation.sender_address as string);
    const poolMessage = result.l2_to_l1_messages?.find(
      (message) =>
        message.from_address && BigInt(message.from_address) === BigInt(sender)
    );

    return {
      data: result.proof,
      output: poolMessage?.payload ?? [],
      proofFacts: result.proof_facts ?? [],
      additionalData: result.additional_data,
    };
  }
}
