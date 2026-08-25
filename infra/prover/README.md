# The Limen Prover

Self-hosted STRK20 proving. Three containers on one Linux machine: the pinned upstream
transaction prover, the Limen Prover Gateway in front of it, and a Cloudflare Tunnel as
the only way in.

```
Limen web (Cloudflare Workers)
        │  HTTPS + bearer token
        ▼
  Cloudflare Tunnel ──► gateway :8787 ──► prover :3000
                        (auth, admission,   (pinned image,
                         idempotency,        no published port)
                         health, metrics)
```

The prover publishes no port. Nothing but the gateway can reach it, and nothing but the
tunnel can reach the gateway.

## What the host needs

| | Minimum | Recommended | Why |
| --- | --- | --- | --- |
| Architecture | x86_64 | x86_64 | The published `linux/arm64` image aborts with SIGILL on generic aarch64. See CONTRIBUTIONS.md |
| RAM | 24 GB | 96 GB | Measured: at 12 GB the prover is killed 21–29 s into every proof |
| vCPU | 8 | 48 | Upstream recommends `c4d-highcpu-48` for production throughput |
| Disk | 20 GB | 40 GB | The image is 1.12 GB; the rest is working space and logs |
| Docker | Engine + Compose v2 | | |

`setup.sh` refuses to start below the minimum rather than letting you discover it as a
proof dying partway through.

### Why not smaller

The proving core is what needs the memory, not anything tunable. On Cloudflare's
largest container (4 vCPU / 12 GiB) five distinct proofs were all killed 21–29 s in,
and the behaviour was identical with `PREFETCH_STATE=false` and
`COMPILED_CLASS_CACHE_SIZE=32`. Full write-up in DECISIONS.md D-011.

## Setup

```sh
git clone <this repo> && cd limen/infra/prover
cp .env.example .env
$EDITOR .env          # RPC URL, gateway token, tunnel token
./setup.sh
```

`setup.sh` checks architecture, memory, Docker, and the RPC endpoint's spec version
before starting anything, then waits for the prover to answer.

### The three values in `.env`

**`PROVER_RPC_URL`** — must serve Starknet JSON-RPC spec **0.10.x**. Older endpoints
fail mid-proof with `missing field state_diff_commitment`, which does not look like an
RPC problem when you hit it. Alchemy's `v0_10` path works:
`https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/<KEY>`. Treated as a
credential: passed to the container at start, never baked into the image, never logged.

**`GATEWAY_TOKEN`** — bearer token on every proving request.

```sh
openssl rand -base64 32 | tr -d '\n' | tr '+/' '-_'
```

The same value goes into the web app as the `LIMEN_GATEWAY_TOKEN` secret. Without it
the gateway is an open proving oracle and anyone can spend the host's capacity.

**`CLOUDFLARE_TUNNEL_TOKEN`** — from a Zero Trust tunnel whose public hostname routes to
`http://gateway:8787`. In the Cloudflare dashboard: Zero Trust → Networks → Tunnels →
Create a tunnel → Docker → copy the token from the `--token` argument, then add a public
hostname pointing at that service.

## Checking it

```sh
# Liveness. Unauthenticated on purpose, and exposes no request content.
curl -s http://127.0.0.1:8787/health | jq

# Real numbers.
curl -s -H "authorization: Bearer $GATEWAY_TOKEN" http://127.0.0.1:8787/metrics | jq

# Recent jobs, with no request content in them.
curl -s -H "authorization: Bearer $GATEWAY_TOKEN" http://127.0.0.1:8787/jobs | jq
```

`healthy: true` means the prover answered JSON-RPC, not merely that a process exists.

Then, from a machine with the repository:

```sh
LIMEN_GATEWAY_URL=https://<your-tunnel-hostname> \
LIMEN_GATEWAY_TOKEN=<token> \
node --experimental-strip-types scripts/prover-benchmark.ts --samples 20
```

That replays real mainnet transactions against the block before they were included. No
funds move and nothing is submitted, so it costs only the host's own time. Results land
in `evidence/benchmarks/`.

## API

`POST /` speaks the same JSON-RPC the STRK20 SDK expects, so the gateway is a drop-in
`provingProvider` URL.

| Method | Notes |
| --- | --- |
| `starknet_proveTransaction` | Requires `Authorization: Bearer`. Send `Idempotency-Key` and a retry returns the original result instead of proving twice |
| `starknet_specVersion` | Proxied from the prover |

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness and readiness |
| `GET /metrics` | bearer | Counters, p50/p95, uptime |
| `GET /jobs` | bearer | Recent jobs, request content excluded |

Error codes are the prover's own, so a client sees one behaviour whether the gateway
or the prover rejected the call: `24` block not found, `55` validation failed, `61`
unsupported transaction, `1000` invalid input, `-32005` busy, `-32603` internal.

## Operating

```sh
docker compose ps
docker compose logs -f gateway
docker compose logs --tail 100 prover
docker compose restart prover     # the gateway releases jobs stranded by the restart
docker compose down
```

A proof in flight when the prover dies is terminal, not still running. The gateway
detects the restart on its next health probe and releases those jobs, so a crash cannot
permanently consume an admission slot.

### When something is wrong

| Symptom | Cause |
| --- | --- |
| Prover log stops mid-proof, container restarts | Out of memory. Raise `PROVER_MEMORY_LIMIT`, or use a bigger host |
| `missing field state_diff_commitment` | The RPC endpoint is not on spec 0.10.x |
| `Illegal instruction` at startup | Not an x86_64 host |
| Every proof returns `-32005` | Admission slots stranded. `docker compose restart gateway` |
| `argent/invalid-owner-sig` on a replay | Fee fields were rewritten, changing the transaction hash |

## What the prover learns

It receives the full signed transaction, and for a STRK20 client action that calldata
contains the user's private viewing key. Treat this host as holding key material:

- the gateway never writes request content to a log, a metric, or an error, and
  `packages/proving-core/src/redact.test.ts` is the proof,
- nothing is persisted to disk; the ledger is in-memory and holds only counters,
  durations, outcomes and proof results,
- container logs are capped and rotated,
- the prover is reachable only from the gateway, and the gateway only through the
  tunnel.

SECURITY.md carries the full trust boundary.
