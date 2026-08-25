# Build log

Running record of what was built, what was measured, and what it cost. Newest first.

---

## 2026-08-25 — Session 1

### Paused

Paused at the owner's request while a blocking product decision is open (see
**Open decision** below). The prover container was stopped so nothing bills while idle.

### Done

**G0 — bootstrap.** Repository, workspace, Apache-2.0 licensing, `.gitignore` that
excludes every secret path. STRK20 skills installed
(`npx skills add welttowelt/strk20-skills`) and read end to end before any protocol
code was written.

**G1 — authoritative protocol map. Passed, with evidence rather than assertion.**

- The monorepo's `main` is pool version `2.1`; mainnet runs `2.0`. Building against
  `main` would have been wrong in ways that matter. DECISIONS.md D-001.
- Compiled the pinned upstream revision `74841ca` and got class hash
  `0x67dddd89…b554d`, **bit-for-bit equal to the class deployed at the mainnet pool**.
  Reproducible via `tools/verify-pool-source.ts` →
  `evidence/mainnet/pool-source-parity.json`.
- Live pool state read from chain, never hardcoded
  (`evidence/mainnet/pool-state.json`): fee **6 STRK** per `apply_actions` (the docs
  said 4), `proof_validity_blocks` 450, screener and auditor keys, class hash.
- **Deposits into open notes are not screened on the deployed pool.** v2.1 would make
  a third-party anonymizer the screening subject on every clearance, needing Elliptic
  partner credentials Limen cannot obtain. v2.0 has only a governance denylist. This
  is what makes Limen buildable at all. D-002.
- `ComputeAndInvoke` is live on mainnet and gives a protocol-derived, unforgeable,
  address-free subject identity. D-003.

**G3 — contract correctness. 66 Cairo tests, all passing.**

`LimenAnonymizer` (no owner, no admin, no upgrade, no sweep) and `CapitalGate`. The
test fixture reproduces the pool's real `ComputeAndInvoke` sequence — compute at the
proving base, then withdraw, invoke, and pull — so tests exercise the actual ordering
rather than a convenient approximation.

The suite caught a real design flaw. An ERC-20 balance carries no provenance, so a
subject can publicly top the anonymizer up between proving and execution and have it
stand in for private capital. It cannot be closed inside the contract; every avenue
was checked against the deployed class. The pool publishes what it withdrew and to
whom in the same transaction, so the split is on-chain for every clearance and is now
asserted by the verifier, the explorer, and two contract tests. Written up in full in
DECISIONS.md **D-007**. The claim was not weakened to route around it.

**TypeScript packages — 48 tests passing.** `protocol-config` (live chain reads,
exact 18-decimal arithmetic with no float anywhere), `proving-core` (provider seam,
retry classification that only retries what upstream defines as transient, redaction
with tests proving a viewing key cannot reach a log), `limen-sdk` (challenge and
subject derivation, clearance planning, transaction verifier).

Challenge-id derivation is pinned by one shared constant asserted independently in
Cairo and in TypeScript, so a change on either side turns exactly one suite red.

**G4 — Limen Prover. Deployed and healthy; cannot yet complete a proof.**

The pinned upstream prover image runs as a real Linux container on Cloudflare
Containers, behind a gateway Worker doing auth, validation, admission control,
idempotency, job accounting, health and redaction. Health reports spec `0.10.3-rc.2`.
Live at `https://limen-prover-gateway.timjosh507.workers.dev`.

### Measured

| Finding | Evidence |
| --- | --- |
| Published `linux/arm64` prover image aborts with **SIGILL** on generic aarch64 | `docker run … --version` → exit 132, `Illegal instruction`; host lacks `sve`/`bf16`/`i8mm`. Upstream report pending, CONTRIBUTIONS.md |
| Prover needs an RPC serving the full v0.10 surface | `rpc.starknet.lava.build` (spec 0.10.2) fails with `missing field state_diff_commitment`. Alchemy's `v0_10` path serves `0.10.3-rc.0` and works |
| Replaying a signed mainnet transaction needs `SKIP_FEE_FIELD_VALIDATION` | Zeroing fee fields changes the transaction hash, so `__validate__` panics with `argent/invalid-owner-sig`. Limen's own clearances are unaffected: the pool's `__validate__` requires zero fee fields anyway |
| **Cloudflare's largest container cannot complete a STRK20 proof** | `standard-4` (4 vCPU / 12 GiB) dies with `Container suddenly disconnected` after 21–29 s of real proving, across 5 distinct transactions. Unchanged with `PREFETCH_STATE=false` and `COMPILED_CLASS_CACHE_SIZE=32`, so it is the prover core, not caches |

Upstream recommends 48 vCPU / 96 GB; the STRK20 skill cites ~29 s on 12 cores /
46 GiB. 12 GiB is roughly a quarter of the smallest configuration anyone reports
working, and Cloudflare caps custom instance types at `standard-4`.

### Open decision — needs the owner

Cloudflare Containers cannot host the Limen Prover, and the instruction was to keep
everything on Cloudflare. Those two cannot both hold. PRD §26 kill criterion 2 is
adjacent but not met: the upstream stack can produce the proof, this host cannot.
Options are in the handover message.

### Waiting on

- **Funding.** `0x1d71af6cf06f5789e9ace1512a384b223879d6f43e835ab4ac38e81a38a8fe4`,
  SN_MAIN, ~80 STRK. Covers account deploy, two contract declares and deploys, the
  6 STRK live pool fee across register/shield plus two clearances, the shielded demo
  capital, and retry headroom.
- **Alchemy Starknet Mainnet RPC key.** The public endpoint is missing fields the
  prover needs; the shared demo key works but is rate-limited and unsuitable for the
  canonical run.

### Not started

Web app, adversarial campaign runner, mainnet deployment and evidence, CI,
`strk20.json`, `evidence/claims.json`, README/ARCHITECTURE/SECURITY/SETUP,
upstream contribution filing.
