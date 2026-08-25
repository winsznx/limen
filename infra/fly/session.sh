#!/usr/bin/env bash
# One Limen proving session on Fly.io: bring the prover up, do the work, tear it down.
#
# Proving is bursty, not continuous. The expensive machine exists only while it is
# actually proving, and this script makes leaving it running by accident hard: it always
# prints the destroy command, and `--auto-destroy` removes the machine on the way out
# even if the work in the middle failed.
#
#   ./infra/fly/session.sh up          bring the prover up
#   ./infra/fly/session.sh status      what is running, and what it is costing
#   ./infra/fly/session.sh down        destroy the prover (the gateway stays)
#   ./infra/fly/session.sh cost        estimate what this session has cost so far
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PROVER_APP="limen-prover"
GATEWAY_APP="limen-prover-gateway"

# Approximate, for a running estimate only. Fly's invoice is authoritative.
# performance-4x preset plus 24 GB of additional RAM at $5 per GB per 30 days.
COST_PER_HOUR="0.31"

export FLYCTL_INSTALL="${FLYCTL_INSTALL:-$HOME/.fly}"
export PATH="$FLYCTL_INSTALL/bin:$PATH"

note() { printf '  %s\n' "$1"; }
fail() { printf '\n  %s\n\n' "$1" >&2; exit 1; }

command -v fly >/dev/null || fail "flyctl is not installed. curl -fsSL https://fly.io/install.sh | sh"
fly auth whoami >/dev/null 2>&1 || fail "Not logged in. Run: fly auth login"

machine_ids() {
  fly machines list -a "$1" --json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s).forEach(m=>console.log(m.id))}catch{}})'
}

case "${1:-status}" in

up)
  printf '\nBringing the Limen Prover up\n\n'

  fly secrets list -a "$PROVER_APP" 2>/dev/null | grep -q RPC_URL \
    || fail "RPC_URL is not set on $PROVER_APP.
  It must be a Starknet mainnet endpoint on spec 0.10.x. Older endpoints fail
  mid-proof with 'missing field state_diff_commitment'.

    fly secrets set -a $PROVER_APP RPC_URL='https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/<KEY>'"

  note "deploying the pinned prover image (1.12 GB, first pull is slow)…"
  # --ha=false: Fly otherwise creates a second machine for high availability, which
  # at 32 GB silently doubles the hourly cost for no benefit to a batch prover.
  fly deploy --config infra/fly/prover.fly.toml --app "$PROVER_APP" --ha=false --yes

  note "waiting for the prover to answer through the gateway…"
  GATEWAY_URL="https://${GATEWAY_APP}.fly.dev"
  for attempt in $(seq 1 40); do
    if curl -fsS -m 20 "$GATEWAY_URL/health" 2>/dev/null | grep -q '"healthy":true'; then
      printf '\n  Prover is serving.\n\n'
      curl -fsS "$GATEWAY_URL/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("    spec       ",j.specVersion);console.log("    probe      ",j.latencyMs+"ms")})'
      printf '\n  Billing has started. When the session ends:\n'
      printf '    ./infra/fly/session.sh down\n\n'
      exit 0
    fi
    sleep 15
  done

  printf '\n  The prover did not become healthy. Recent logs:\n\n'
  fly logs -a "$PROVER_APP" --no-tail 2>&1 | tail -30
  fail "Prover did not come up. If the log stops abruptly mid-proof, it ran out of memory.
  The machine is still running and still billing. Destroy it with:
    ./infra/fly/session.sh down"
  ;;

down)
  printf '\nDestroying the Limen Prover\n\n'
  found=0
  for id in $(machine_ids "$PROVER_APP"); do
    found=1
    note "destroying $id"
    # Destroy, not stop: a stopped machine still bills for its root filesystem.
    fly machine destroy --force -a "$PROVER_APP" "$id" >/dev/null 2>&1 || true
  done
  [ "$found" -eq 1 ] || note "nothing running"

  printf '\n  Prover destroyed. Billing has stopped.\n'
  printf '  The gateway stays up and now reports unhealthy, which is accurate.\n\n'
  ;;

status)
  printf '\nLimen on Fly\n\n'
  printf '  prover machines\n'
  fly machines list -a "$PROVER_APP" 2>/dev/null | tail -n +2 | sed 's/^/    /' || note "    app not found"
  printf '\n  gateway\n'
  fly machines list -a "$GATEWAY_APP" 2>/dev/null | tail -n +2 | sed 's/^/    /' || note "    app not found"
  printf '\n  health\n'
  curl -fsS -m 15 "https://${GATEWAY_APP}.fly.dev/health" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log("    healthy    ",j.healthy);console.log("    reason     ",j.reason??"-")}catch{console.log("    unreachable")}})' \
    || note "    unreachable"
  printf '\n'
  ;;

cost)
  # Uptime of the running prover machine, times the approximate hourly rate.
  # Kept on one line: a `)` alone on a line inside a case arm terminates the arm.
  created=$(fly machines list -a "$PROVER_APP" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const m=JSON.parse(s)[0];console.log(m&&m.state==="started"?m.created_at:"")}catch{}})')
  printf '\n'
  if [ -z "$created" ]; then
    note "no prover machine running — nothing accruing"
  else
    hours=$(node -e "console.log(((Date.now()-Date.parse('$created'))/3.6e6).toFixed(2))")
    est=$(node -e "console.log((($hours)*$COST_PER_HOUR).toFixed(2))")
    note "prover has been up ${hours}h"
    note "estimated ~\$${est} so far at ~\$${COST_PER_HOUR}/hr"
    note "approximate only — Fly's invoice is authoritative"
  fi
  printf '\n'
  ;;

*)
  fail "usage: session.sh [up|down|status|cost]"
  ;;
esac
