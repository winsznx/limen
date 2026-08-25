#!/usr/bin/env bash
# Brings up the Limen Prover on a Docker-capable Linux host.
#
# Checks the machine can actually run a STRK20 proof before starting anything, because
# the failure mode otherwise is a container killed 25 seconds into a proof with a
# message that does not mention memory.
#
#   cp .env.example .env && $EDITOR .env
#   ./setup.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

fail() { printf '\n  %s\n\n' "$1" >&2; exit 1; }
note() { printf '  %s\n' "$1"; }

printf '\nLimen Prover setup\n\n'

# ---------------------------------------------------------------- preflight

[ -f .env ] || fail "No .env here. Run: cp .env.example .env && \$EDITOR .env"
set -a; . ./.env; set +a

: "${PROVER_RPC_URL:?PROVER_RPC_URL is not set in .env}"
: "${GATEWAY_TOKEN:?GATEWAY_TOKEN is not set in .env}"
: "${CLOUDFLARE_TUNNEL_TOKEN:?CLOUDFLARE_TUNNEL_TOKEN is not set in .env}"

command -v docker >/dev/null || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 is not available"
docker info >/dev/null 2>&1 || fail "the docker daemon is not reachable from this user"

ARCH="$(uname -m)"
if [ "$ARCH" != "x86_64" ]; then
  fail "This host is $ARCH. The prover image only runs correctly on x86_64: the
  published linux/arm64 variant aborts with SIGILL on generic aarch64. See
  CONTRIBUTIONS.md."
fi

TOTAL_MEM_GB=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
CORES=$(nproc 2>/dev/null || echo 0)
note "host: ${CORES} cores, ${TOTAL_MEM_GB} GB RAM, ${ARCH}"

if [ "$TOTAL_MEM_GB" -lt 24 ]; then
  fail "This host has ${TOTAL_MEM_GB} GB of RAM. A STRK20 proof needs roughly 24 GB
  and upstream recommends 96 GB. Measured: at 12 GB the prover is killed 21-29s into
  every proof. Use a larger machine, or the proofs will not complete."
fi
if [ "$TOTAL_MEM_GB" -lt 48 ]; then
  note "note: ${TOTAL_MEM_GB} GB is below the 96 GB upstream recommends. Proofs should"
  note "      complete, but expect latency well above the ~29s reference figure."
fi
if [ "$CORES" -lt 8 ]; then
  note "note: ${CORES} cores is modest for proving; expect high latency."
fi

# ---------------------------------------------------------------- rpc check

note "checking the RPC endpoint serves what the prover needs…"
RPC_SPEC=$(curl -fsS -m 20 -X POST "$PROVER_RPC_URL" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_specVersion","params":[]}' \
  | sed -n 's/.*"result":"\([^"]*\)".*/\1/p') || fail "The RPC endpoint did not respond."

case "$RPC_SPEC" in
  0.10.*) note "rpc spec $RPC_SPEC" ;;
  *) fail "The RPC endpoint reports spec '$RPC_SPEC'. The prover requires 0.10.x.
  An endpoint on an older spec fails mid-proof with 'missing field
  state_diff_commitment', which is not obviously an RPC problem when you hit it." ;;
esac

# ---------------------------------------------------------------- bring-up

note "starting prover, gateway and tunnel…"
docker compose pull --quiet prover tunnel 2>/dev/null || true
docker compose up -d --build

printf '\n  waiting for the prover to answer (first boot warms its class cache)…\n'
for attempt in $(seq 1 60); do
  if curl -fsS -m 10 "http://127.0.0.1:${GATEWAY_PORT:-8787}/health" 2>/dev/null | grep -q '"healthy":true'; then
    printf '\n  Limen Prover is up.\n\n'
    curl -fsS "http://127.0.0.1:${GATEWAY_PORT:-8787}/health"
    printf '\n\n  Next: point the app at the tunnel hostname and run\n'
    printf '        node --experimental-strip-types scripts/prover-benchmark.ts --samples 20\n\n'
    exit 0
  fi
  sleep 5
done

printf '\n  The prover did not become healthy. Recent logs:\n\n'
docker compose logs --tail 40 prover gateway
fail "Prover did not come up. If the prover log ends abruptly mid-proof, the host ran
  out of memory."
