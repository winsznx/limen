#!/usr/bin/env bash
# Vendors the STRK20 Privacy SDK at the revision that matches the pool class deployed
# on Starknet mainnet.
#
# The package is not on the public npm registry (it 404s), and GitHub Packages needs a
# token even for public reads. Building the pinned source is the only route that works
# from a clean clone with no credentials, and it also pins us to a commit rather than a
# floating tag.
#
# Idempotent. Safe to re-run.
set -euo pipefail

REPO_URL="https://github.com/starkware-libs/starknet-privacy.git"
# Tag CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08, the revision whose `privacy` package
# compiles to the class hash live at the mainnet pool. See DECISIONS.md D-001.
PINNED_COMMIT="74841caf0466d122117945e28ed983e2864c8fc1"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="$ROOT/.vendor/starknet-privacy"

# Ask git whether the checkout works rather than whether a path exists. `.git` is a
# directory for a clone but a pointer file for a worktree, and a pointer into a
# temporary directory goes stale the moment that directory is cleaned. Testing
# usability means a broken checkout is re-fetched instead of failing every command
# that touches it.
if [ "$(git -C "$VENDOR_DIR" rev-parse HEAD 2>/dev/null)" = "$PINNED_COMMIT" ]; then
  echo "vendor: already at $PINNED_COMMIT"
else
  rm -rf "$VENDOR_DIR"
  mkdir -p "$(dirname "$VENDOR_DIR")"
  echo "vendor: fetching $PINNED_COMMIT"
  git init -q "$VENDOR_DIR"
  git -C "$VENDOR_DIR" remote add origin "$REPO_URL"
  git -C "$VENDOR_DIR" fetch -q --depth 1 origin "$PINNED_COMMIT"
  git -C "$VENDOR_DIR" checkout -q FETCH_HEAD
fi

ACTUAL="$(git -C "$VENDOR_DIR" rev-parse HEAD)"
if [ "$ACTUAL" != "$PINNED_COMMIT" ]; then
  echo "vendor: refusing to build, HEAD is $ACTUAL not $PINNED_COMMIT" >&2
  exit 1
fi

if [ ! -f "$VENDOR_DIR/sdk/dist/index.js" ]; then
  echo "vendor: building sdk"
  (cd "$VENDOR_DIR/sdk" && npm ci --no-audit --no-fund --silent && npm run build --silent)
fi

echo "vendor: ready at $VENDOR_DIR/sdk ($(node -p "require('$VENDOR_DIR/sdk/package.json').version"))"
