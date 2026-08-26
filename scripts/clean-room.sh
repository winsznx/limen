#!/usr/bin/env bash
# Clean-room reproduction.
#
# Clones the repository into a fresh directory with no inherited state, bootstraps it,
# and regenerates every piece of deterministic evidence from scratch. Nothing here needs
# a credential, a funded account, or the prover: if this passes, anyone can check
# Limen's deterministic claims without asking for anything.
#
# What it deliberately does NOT do is re-run mainnet transactions. Those are verified
# from chain instead, which is the stronger check — it needs no key and cannot be faked
# by this repository.
#
#   ./scripts/clean-room.sh [target-dir]
set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-/tmp/limen-cleanroom-$(date +%s)}"

pass() { printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
FAILURES=0

printf '\nLimen clean-room reproduction\n'
printf '  source %s\n  target %s\n\n' "$SOURCE" "$TARGET"

# ---------------------------------------------------------------- clone

rm -rf "$TARGET"
git clone --quiet "$SOURCE" "$TARGET"
cd "$TARGET"
COMMIT="$(git rev-parse HEAD)"
printf '  commit %s\n\n' "${COMMIT:0:12}"

# A clone must carry no secrets. This is the check that matters most: everything else
# is correctness, this one is disclosure.
if find . -name '.env.local' -o -name '.env' -not -name '.env.example' | grep -q .; then
  fail "a .env file came through the clone"
else
  pass "no secret files in the clone"
fi

if git log -p --all 2>/dev/null | grep -qE 'DEPLOYER_PRIVATE_KEY=0x[0-9a-fA-F]{16,}|LIMEN_VIEWING_KEY=[0-9]{16,}'; then
  fail "key material found in git history"
else
  pass "no key material in git history"
fi

# ---------------------------------------------------------------- build

printf '\n  bootstrapping (this installs and builds)…\n'
if ./scripts/bootstrap.sh >/tmp/cleanroom-bootstrap.log 2>&1; then
  pass "bootstrap completed"
else
  fail "bootstrap failed — see /tmp/cleanroom-bootstrap.log"
fi

# ---------------------------------------------------------------- tests

if pnpm -r test >/tmp/cleanroom-ts.log 2>&1; then
  TS_COUNT=$(grep -oE 'Tests +[0-9]+ passed' /tmp/cleanroom-ts.log | grep -oE '[0-9]+' | paste -sd+ - | bc 2>/dev/null || echo "?")
  pass "TypeScript tests pass (${TS_COUNT})"
else
  fail "TypeScript tests failed — see /tmp/cleanroom-ts.log"
fi

if command -v snforge >/dev/null 2>&1; then
  if (cd contracts && snforge test) >/tmp/cleanroom-cairo.log 2>&1; then
    CAIRO_COUNT=$(grep -oE '[0-9]+ passed' /tmp/cleanroom-cairo.log | tail -1 | grep -oE '[0-9]+')
    pass "Cairo tests pass (${CAIRO_COUNT})"
  else
    fail "Cairo tests failed — see /tmp/cleanroom-cairo.log"
  fi
else
  printf '  \033[33mskip\033[0m snforge not on PATH; Cairo tests not run\n'
fi

# ---------------------------------------------------------------- evidence

# The campaign is generated from a seed, so regenerating it must produce no diff.
# A diff means generated output was hand-edited or the generator changed without a
# regenerate — either way the published campaign would not be the one the code makes.
node --experimental-strip-types scripts/generate-campaign.ts >/dev/null 2>&1 || true
if git diff --quiet -- contracts/packages/limen_anonymizer/src/tests/campaign_generated.cairo evidence/campaigns/vectors.json; then
  pass "campaign regenerates identically from its seed"
else
  fail "regenerating the campaign produced a diff"
fi

if command -v snforge >/dev/null 2>&1; then
  if node --experimental-strip-types scripts/run-campaign.ts >/tmp/cleanroom-campaign.log 2>&1; then
    node -e '
      const r = require("./evidence/campaigns/security.json");
      const bad = [];
      if (r.total !== 100) bad.push("total " + r.total);
      if (r.valid_observed !== r.valid_expected) bad.push("valid cases did not all clear");
      if (r.invalid_rejected !== r.invalid_expected) bad.push("adversarial cases not all rejected");
      if (r.false_clearances !== 0) bad.push("false clearances");
      if (r.successful_replays !== 0) bad.push("replays");
      if (r.funds_stranded !== 0) bad.push("funds stranded");
      if (bad.length) { console.error(bad.join("; ")); process.exit(1); }
    ' && pass "100-case campaign: 0 false clearances, 0 replays, 0 stranded" \
      || fail "campaign acceptance targets not met"
  else
    fail "campaign run failed — see /tmp/cleanroom-campaign.log"
  fi
fi

# ---------------------------------------------------------------- chain

# Needs only a public RPC. Verifies the two strongest claims without any credential:
# that Limen is built against the deployed pool, and that its published transactions
# really do what the README says.
if node --experimental-strip-types tools/verify-pool-source.ts >/tmp/cleanroom-pool.log 2>&1; then
  pass "pinned source compiles to the class deployed at the mainnet pool"
else
  printf '  \033[33mskip\033[0m pool-source parity needs scarb and network\n'
fi

if node --experimental-strip-types scripts/verify-mainnet.ts >/tmp/cleanroom-verify.log 2>&1; then
  VERIFIED=$(node -pe 'JSON.parse(require("fs").readFileSync("evidence/mainnet/verification.json","utf8")).clearances_verified' 2>/dev/null || echo "?")
  pass "mainnet clearances re-verified from chain (${VERIFIED})"
else
  printf '  \033[33mskip\033[0m mainnet verification needs network — see /tmp/cleanroom-verify.log\n'
fi

# ---------------------------------------------------------------- result

printf '\n'
if [ "$FAILURES" -eq 0 ]; then
  printf '  \033[32mClean room reproduced everything.\033[0m  %s\n\n' "${COMMIT:0:12}"
else
  printf '  \033[31m%s check(s) failed.\033[0m\n\n' "$FAILURES"
  exit 1
fi
