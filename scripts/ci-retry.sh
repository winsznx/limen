#!/usr/bin/env bash
# Retries a command whose failure mode is somebody else's network.
#
# CI has gone red three times for reasons that had nothing to do with this repository:
# the Cairo package registry resetting a connection mid-download, a public Starknet RPC
# timing out, a git clone stalling. A build that is red for reasons the author cannot
# act on teaches people to stop reading builds, which costs more than the flake did.
#
# This only wraps steps that reach a third-party service. It is not a way to make a
# failing check pass: a command that fails deterministically still fails here, it just
# takes a few more seconds to say so.
#
#   ./scripts/ci-retry.sh <command> [args...]
set -uo pipefail

ATTEMPTS="${CI_RETRY_ATTEMPTS:-3}"
DELAY="${CI_RETRY_DELAY:-15}"

if [ "$#" -eq 0 ]; then
  echo "usage: ci-retry.sh <command> [args...]" >&2
  exit 2
fi

attempt=1
while true; do
  # Run it plainly and capture the status directly. Reading $? after a failed `if`
  # returns the status of the if-statement, which is 0, so that spelling would report
  # every failure as a success.
  "$@"
  status=$?

  if [ "$status" -eq 0 ]; then
    [ "$attempt" -gt 1 ] && echo "ci-retry: succeeded on attempt ${attempt}/${ATTEMPTS}"
    exit 0
  fi

  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    echo "ci-retry: '$*' failed ${ATTEMPTS}/${ATTEMPTS} times, exit ${status}" >&2
    exit "$status"
  fi

  echo "ci-retry: attempt ${attempt}/${ATTEMPTS} failed with exit ${status}, retrying in ${DELAY}s" >&2
  sleep "$DELAY"
  attempt=$((attempt + 1))
  # Back off, because a registry that just reset a connection is often still busy.
  DELAY=$((DELAY * 2))
done
