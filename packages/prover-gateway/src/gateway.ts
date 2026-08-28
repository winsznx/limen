import { redactString, safeStringify } from "@limen/proving-core";
import { Ledger } from "./ledger.js";
import { validateProveParams } from "./validate.js";

/**
 * The Limen Prover Gateway.
 *
 * Everything between a client and the proving binary: authentication, request
 * validation, admission control, idempotency, worker-health detection, job accounting,
 * metrics and redaction. It runs beside the prover on the Docker host, and the prover
 * itself is never exposed.
 *
 * One invariant sits above the rest: nothing this file logs, counts, or returns may
 * contain request content. A proving request carries the user's private viewing key
 * inside its calldata.
 */

export interface GatewayConfig {
  /** Where the pinned prover container listens. Private to the compose network. */
  proverUrl: string;
  /** Bearer token required on every proving request. */
  token: string;
  maxConcurrent: number;
  maxQueued: number;
  /** Wall-clock budget for a single proof. */
  proveTimeoutMs: number;
  /** Budget for a health probe. Short, so health stays fast. */
  healthTimeoutMs: number;
  imageReference: string;
}

const JSON_RPC = "2.0";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

export interface GatewayResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

function rpcError(
  id: number | string | null,
  code: number,
  message: string,
  data?: string
): GatewayResponse {
  // JSON-RPC errors travel with HTTP 200; the transport succeeded, the call did not.
  return { status: 200, body: { jsonrpc: JSON_RPC, id, error: { code, message, ...(data ? { data } : {}) } } };
}

/** Length-independent comparison so the token cannot be recovered by timing. */
function tokensMatch(provided: string, expected: string): boolean {
  if (expected.length === 0) return false;
  let difference = provided.length ^ expected.length;
  const length = Math.max(provided.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (provided.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export class ProverGateway {
  readonly ledger: Ledger;
  private lastProverBootId: string | null = null;

  constructor(private readonly config: GatewayConfig) {
    this.ledger = new Ledger({
      maxConcurrent: config.maxConcurrent,
      maxQueued: config.maxQueued,
    });
  }

  authorize(authorizationHeader: string | undefined): boolean {
    const provided = authorizationHeader?.startsWith("Bearer ")
      ? authorizationHeader.slice(7)
      : "";
    return tokensMatch(provided, this.config.token);
  }

  /**
   * Health that reflects whether the prover can serve, not whether a process exists.
   *
   * It also detects a prover restart. The prover reports no boot identifier, so a
   * transition from unreachable back to reachable is treated as one, and any job still
   * marked running is released, because otherwise a crash would permanently consume an
   * admission slot and the gateway would wedge at "busy" forever.
   */
  async health(): Promise<GatewayResponse> {
    const startedAt = Date.now();
    let healthy = false;
    let specVersion: string | undefined;
    let reason: string | undefined;

    try {
      const response = await this.callProver(
        { jsonrpc: JSON_RPC, id: 1, method: "starknet_specVersion", params: [] },
        this.config.healthTimeoutMs
      );
      const text = await response.text();
      try {
        specVersion = (JSON.parse(text) as { result?: string }).result;
      } catch {
        specVersion = undefined;
      }
      healthy = response.ok && typeof specVersion === "string";
      if (!healthy) reason = `prover returned ${response.status}: ${redactString(text).slice(0, 200)}`;
    } catch (error) {
      reason = redactString(error instanceof Error ? error.message : String(error)).slice(0, 200);
    }

    if (healthy) {
      const bootId = `up:${specVersion}`;
      if (this.lastProverBootId !== null && this.lastProverBootId !== bootId) {
        const released = this.ledger.releaseStuckJobs();
        if (released > 0) console.log(safeStringify({ event: "prover.restart_detected", released }));
      }
      this.lastProverBootId = bootId;
    } else if (this.lastProverBootId !== null) {
      const released = this.ledger.releaseStuckJobs();
      if (released > 0) console.log(safeStringify({ event: "prover.unreachable", released }));
      this.lastProverBootId = null;
    }

    const metrics = this.ledger.metrics();
    return {
      status: healthy ? 200 : 503,
      body: {
        healthy,
        kind: "limen-self-hosted",
        name: "Limen Prover",
        specVersion,
        latencyMs: Date.now() - startedAt,
        activeJobs: metrics.active,
        queueDepth: metrics.queued,
        image: this.config.imageReference,
        reason,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  metrics(): GatewayResponse {
    return {
      status: 200,
      body: { ...this.ledger.metrics(), image: this.config.imageReference },
    };
  }

  jobs(): GatewayResponse {
    return { status: 200, body: { jobs: this.ledger.recent() } };
  }

  async rpc(body: JsonRpcRequest, idempotencyKey?: string): Promise<GatewayResponse> {
    const id = body.id ?? null;
    if (body.jsonrpc !== JSON_RPC) {
      return rpcError(id, -32600, "Invalid Request", "jsonrpc must be 2.0");
    }

    if (body.method === "starknet_specVersion") {
      try {
        const response = await this.callProver(
          { jsonrpc: JSON_RPC, id, method: "starknet_specVersion", params: [] },
          this.config.healthTimeoutMs
        );
        return { status: 200, body: await response.json() };
      } catch (error) {
        return rpcError(id, -32603, "Prover unavailable", this.redact(error));
      }
    }

    if (body.method !== "starknet_proveTransaction") {
      return rpcError(id, -32601, "Method not found");
    }

    return this.prove(id, body.params, idempotencyKey);
  }

  private async prove(
    id: number | string | null,
    params: unknown,
    idempotencyKey?: string
  ): Promise<GatewayResponse> {
    const validation = validateProveParams(params, { allowNonZeroFeeFields: true });
    if (!validation.ok) {
      // Rejected before the container is touched, so a malformed payload can never
      // occupy the single proving slot.
      this.ledger.recordRejected(validation.code);
      return rpcError(id, validation.rpcCode, validation.message, validation.detail);
    }

    if (idempotencyKey) {
      const replayed = this.ledger.replay(idempotencyKey);
      if (replayed) {
        // Clients retry on timeouts. Proving the same transaction again would double
        // the cost of the scarcest resource Limen operates for an identical answer.
        return {
          status: 200,
          body: { jsonrpc: JSON_RPC, id, result: replayed },
          headers: { "x-limen-deduplicated": "true" },
        };
      }
    }

    const admission = this.ledger.admit();
    if (!admission.admitted) {
      return rpcError(id, -32005, "Service busy", "gateway at capacity, retry later");
    }

    const { requestId } = admission;
    const startedAt = Date.now();

    try {
      const response = await this.callProver(
        {
          jsonrpc: JSON_RPC,
          id: 1,
          method: "starknet_proveTransaction",
          params: validation.params,
        },
        this.config.proveTimeoutMs
      );

      // Read as text first. A prover that dies mid-proof answers with something that
      // is not JSON, and parsing eagerly would replace the only diagnostic there is.
      const raw = await response.text();
      const durationMs = Date.now() - startedAt;

      let payload: {
        result?: { proof?: unknown; proof_facts?: unknown };
        error?: { code: number; message: string; data?: string };
      };
      try {
        payload = JSON.parse(raw) as typeof payload;
      } catch {
        this.ledger.complete(requestId, { outcome: "failed", reason: "prover_lost", durationMs });
        return rpcError(
          id,
          -32603,
          "Prover did not complete",
          `prover response (${response.status}): ${redactString(raw).slice(0, 200)}`
        );
      }

      if (payload.error) {
        this.ledger.complete(requestId, {
          outcome: "failed",
          reason: `rpc_${payload.error.code}`,
          durationMs,
        });
        return rpcError(id, payload.error.code, payload.error.message, payload.error.data);
      }

      // Success is only reported once the result has the shape the pool needs. A
      // truncated result would otherwise surface as an on-chain revert that costs a
      // pool fee.
      const proof = payload.result?.proof;
      const proofFacts = payload.result?.proof_facts;
      if (typeof proof !== "string" || proof.length === 0 || !Array.isArray(proofFacts)) {
        this.ledger.complete(requestId, {
          outcome: "failed",
          reason: "malformed_result",
          durationMs,
        });
        return rpcError(id, -32603, "Prover returned an unusable result");
      }

      this.ledger.complete(requestId, {
        outcome: "succeeded",
        durationMs,
        blockNumber: validation.blockNumber,
        proofFactsCount: proofFacts.length,
      });
      if (idempotencyKey) this.ledger.remember(idempotencyKey, payload.result);

      return {
        status: 200,
        body: { jsonrpc: JSON_RPC, id, result: payload.result },
        headers: {
          "x-limen-request-id": requestId,
          "x-limen-duration-ms": String(durationMs),
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      this.ledger.complete(requestId, {
        outcome: "failed",
        reason: timedOut ? "timeout" : "unavailable",
        durationMs,
      });
      console.log(safeStringify({ event: "prove.failed", requestId, durationMs, timedOut }));
      return rpcError(
        id,
        timedOut ? -32005 : -32603,
        timedOut ? "Proving timed out" : "Prover unavailable",
        this.redact(error)
      );
    }
  }

  private callProver(body: unknown, timeoutMs: number): Promise<Response> {
    return fetch(this.config.proverUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  private redact(error: unknown): string {
    return redactString(error instanceof Error ? error.message : String(error)).slice(0, 200);
  }
}
