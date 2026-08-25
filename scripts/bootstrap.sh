#!/usr/bin/env bash
# Gets a fresh clone to the point where every deterministic test and every piece of
# offline evidence can be regenerated. No credentials, no funds, no accounts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

note() { printf '  %s\n' "$1"; }
fail() { printf '\n  %s\n\n' "$1" >&2; exit 1; }

printf '\nLimen bootstrap\n\n'

# ---------------------------------------------------------------- node

command -v node >/dev/null || fail "node is not installed. Limen needs Node >= 24."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || fail "node $(node -v) is too old. The Privacy SDK needs >= 24 for WebCrypto."
note "node $(node -v)"

corepack enable >/dev/null 2>&1 || true
command -v pnpm >/dev/null || fail "pnpm is not available. Try: corepack enable"
note "pnpm $(pnpm --version)"

# ---------------------------------------------------------------- cairo

CAIRO_OK=1
if command -v scarb >/dev/null && command -v snforge >/dev/null; then
  note "scarb $(scarb --version | head -1 | awk '{print $2}'), snforge $(snforge --version | awk '{print $2}')"
else
  CAIRO_OK=0
  note "scarb/snforge not on PATH — Cairo tests will be skipped"
  note "  install: curl --proto '=https' --tlsv1.2 -sSf https://sh.starkup.dev | sh"
  note "  versions are pinned in contracts/.tool-versions"
fi

# ---------------------------------------------------------------- deps

note "installing workspace dependencies…"
pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null

# The Privacy SDK is not on the public npm registry, so it is built from the pinned
# upstream revision rather than downloaded. See DECISIONS.md D-001.
note "vendoring the pinned STRK20 Privacy SDK…"
./scripts/vendor-sdk.sh

note "building packages…"
pnpm -r --filter './packages/*' build >/dev/null

# ---------------------------------------------------------------- verify

printf '\n  running deterministic tests…\n\n'
pnpm -r test 2>&1 | grep -E "Tests {2}|Test Files" || true

if [ "$CAIRO_OK" -eq 1 ]; then
  printf '\n'
  (cd contracts && snforge test 2>&1 | tail -1)
fi

printf '\n  Ready. Evidence you can regenerate with no credentials:\n\n'
printf '    node --experimental-strip-types tools/verify-pool-source.ts   # pinned source == deployed class\n'
printf '    node --experimental-strip-types tools/probe-mainnet.ts        # live pool parameters\n'
printf '    node --experimental-strip-types scripts/run-campaign.ts       # 100-case adversarial campaign\n'
printf '\n  Anything needing credentials is in SETUP.md.\n\n'
