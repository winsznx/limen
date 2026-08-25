# The Limen Prover.
#
# This is the STRK20 transaction prover, unmodified, pinned by content digest rather
# than by tag so the image cannot change under a re-deploy. Limen adds no code here on
# purpose: the proving binary is the part that must be trustworthy, and the smallest
# claim to make about it is "it is exactly the published artefact".
#
# Everything Limen does add — request validation, admission control, idempotency, job
# state, health, metrics, redaction — lives in the Limen Prover Gateway in front of
# this container, never inside it.
#
# Pinned: ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2
#   index digest  sha256:a2f71d7139069fa566c4f44bdd66b79cac992c0cbc20ddf0af3a3558c6cabd64
#   linux/amd64   sha256:a62e7764e034ea25d84d4a235f1f683f7c5f03f88f6646a744599171bf5ca58c
#   linux/arm64   sha256:9882d27692b420a9edae9b50bf8075103044230de0f83ee6bed3db19cace105f  (see NOTE)
#
# NOTE: the published linux/arm64 variant aborts with SIGILL on generic aarch64 hosts,
# including Apple Silicon. Limen therefore pins the linux/amd64 manifest explicitly.
# Reproduction and upstream report: CONTRIBUTIONS.md.
FROM --platform=linux/amd64 ghcr.io/starkware-libs/starknet-privacy/transaction-prover@sha256:a62e7764e034ea25d84d4a235f1f683f7c5f03f88f6646a744599171bf5ca58c

# RPC_URL is injected by the gateway at start, never baked into the image: it is a
# credentialed endpoint.
#
# The prover binds loopback-only. Nothing reaches it except the gateway, over the
# container's private port; there is no public unauthenticated prover port.
ENV PROVER_IP=0.0.0.0 \
    PROVER_PORT=3000 \
    CHAIN_ID=SN_MAIN \
    MAX_CONCURRENT_REQUESTS=1 \
    MAX_CONNECTIONS=8 \
    PREFETCH_STATE=true \
    RUST_LOG=warn

EXPOSE 3000
