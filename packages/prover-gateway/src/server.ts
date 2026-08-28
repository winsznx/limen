#!/usr/bin/env node
/**
 * HTTP entry point for the Limen Prover Gateway.
 *
 * Runs on the Docker host beside the pinned prover container. The prover binds to the
 * compose network only; this process is the sole way to reach it, and a Cloudflare
 * Tunnel is the sole way to reach this process. There is no public prover port.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ProverGateway } from "./gateway.js";
import { safeStringify } from "@limen/proving-core";

const PORT = Number(process.env.PORT ?? "8787");
const HOST = process.env.HOST ?? "0.0.0.0";
/** Refuse bodies large enough to be a memory-exhaustion attempt. */
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? String(8 * 1024 * 1024));

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

const gateway = new ProverGateway({
  proverUrl: process.env.PROVER_URL ?? "http://prover:3000",
  token: required("GATEWAY_TOKEN"),
  maxConcurrent: Number(process.env.MAX_CONCURRENT ?? "1"),
  maxQueued: Number(process.env.MAX_QUEUED ?? "4"),
  proveTimeoutMs: Number(process.env.PROVE_TIMEOUT_MS ?? "900000"),
  healthTimeoutMs: Number(process.env.HEALTH_TIMEOUT_MS ?? "5000"),
  imageReference: process.env.PROVER_IMAGE ?? "unknown",
});

function send(response: ServerResponse, status: number, body: unknown, headers?: Record<string, string>) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  response.end(payload);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const authorized = gateway.authorize(request.headers.authorization);

    try {
      // Liveness: is this process up. Deliberately independent of the prover, because
      // the gateway is expected to outlive it, because the prover exists only during a
      // proving session. Conflating the two means the gateway can only be deployed
      // while the expensive machine is already running.
      if (url.pathname === "/live" && request.method === "GET") {
        return send(response, 200, { alive: true, at: new Date().toISOString() });
      }

      // Readiness: can a proof actually be produced right now. Answers 503 when the
      // prover is not serving, which is the honest answer and what the console renders
      // as unreachable.
      if (url.pathname === "/health" && request.method === "GET") {
        const result = await gateway.health();
        return send(response, result.status, result.body);
      }

      if (url.pathname === "/metrics" && request.method === "GET") {
        if (!authorized) return send(response, 401, { error: "unauthorized" });
        const result = gateway.metrics();
        return send(response, result.status, result.body);
      }

      if (url.pathname === "/jobs" && request.method === "GET") {
        if (!authorized) return send(response, 401, { error: "unauthorized" });
        const result = gateway.jobs();
        return send(response, result.status, result.body);
      }

      if (url.pathname === "/" && request.method === "POST") {
        if (!authorized) {
          // Without this the gateway is an open proving oracle and anyone can spend
          // the host's capacity.
          return send(response, 401, { error: "unauthorized" });
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(request));
        } catch (error) {
          const tooLarge = (error as Error).message === "body too large";
          return send(response, tooLarge ? 413 : 200, {
            jsonrpc: "2.0",
            id: null,
            error: { code: tooLarge ? -32600 : -32700, message: tooLarge ? "Body too large" : "Parse error" },
          });
        }

        const idempotencyKey = request.headers["idempotency-key"];
        const result = await gateway.rpc(
          parsed as Record<string, unknown>,
          typeof idempotencyKey === "string" ? idempotencyKey : undefined
        );
        return send(response, result.status, result.body, result.headers);
      }

      send(response, 404, { error: "not found" });
    } catch (error) {
      console.error(safeStringify({ event: "gateway.unhandled", error }));
      send(response, 500, { error: "internal error" });
    }
  })();
});

// Proving runs long. Node's default socket timeouts would cut a proof in flight.
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 75_000;

server.listen(PORT, HOST, () => {
  console.log(safeStringify({ event: "gateway.listening", port: PORT, host: HOST }));
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(safeStringify({ event: "gateway.shutdown", signal }));
    server.close(() => process.exit(0));
    // Do not wait forever on a proof in flight; the client will retry.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
