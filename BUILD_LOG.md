# Build log

Running record of what was built, what was measured, and what it cost. Newest first.

---

## 2026-08-25 — Session 1

### Resumed

The owner chose to self-host the prover on their own Linux machine, so the Cloudflare
Containers attempt was torn down (worker, container application and image all deleted)
and the prover moved to `infra/prover/`, which is what the PRD architecture describes
anyway. Work continued on everything not blocked on funding or that host.

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

### Done after resuming

**Adversarial campaign — G8 campaign half passed.** 100 deterministic cases across nine
attack shapes, generated from a seeded vector set so the same commit always produces the
same campaign. Each case is an independent test and every adversarial case asserts the
exact error it must fail with, so the oracle is snforge's own reporting rather than a
summary the campaign writes about itself.

```
total 100 · valid 25/25 · adversarial rejected 75/75
false clearances 0 · successful replays 0 · funds stranded 0
```

**Prover gateway moved onto the host.** `packages/prover-gateway` is a single-process
Node service beside the prover: auth, validation before cost, admission control,
idempotency, worker-failure detection, health that means "answers JSON-RPC", metrics and
redaction. Its own tests caught a real bug — the admission counter double-counted queued
jobs, so a `maxConcurrent: 1, maxQueued: 2` gateway wedged after two admissions.
`active` and `queued` are now derived from one counter, because two counters that must
agree eventually disagree.

**Web app deployed.** <https://limen.timjosh507.workers.dev>, Next.js on Cloudflare
Workers via OpenNext. Reads live mainnet state: the landing page shows the pool fee of
6 STRK and pool version 2.0 straight from chain. Every surface renders an explicit
"Not available" where a value is genuinely unknown rather than a placeholder, which is
what makes the console and explorer worth trusting once they are populated.

**Discovery no longer needs an indexer.** The mainnet discovery URL is not published,
and a discovery request carries viewing-key material that the service decrypts. Limen
reads notes from the pool contract directly through a view adapter, verified against
mainnet. Nothing about the account's activity leaves the client. D-014.

**Docs and CI.** README, ARCHITECTURE, SECURITY, SETUP, CONTRIBUTIONS, `claims.json`,
`strk20.json`, and a CI pipeline that runs entirely without credentials — including a
check that regenerating the campaign produces no diff, and a protocol-drift job that
fails if the pinned revision stops matching the deployed pool class.

**A second upstream finding.** The Wallet API exposes four STRK20 actions and none is
compute-and-invoke, so the pool's `identity_key` — the only unforgeable, address-free
user identity in STRK20 — is unreachable from every wallet-based dapp, which is the
route the documentation recommends. Reproduced and written up as CONTRIBUTIONS.md C-2.

### Current totals

```
166  Cairo tests        including the 100-case campaign
 70  TypeScript tests
  0  failures
```

### Still blocked

- **Mainnet deployment and clearances.** `scripts/deploy.ts` and
  `scripts/verify-mainnet.ts` are written and refuse to run against unmet preconditions.
  Waiting on funding.
- **A mainnet proof through the Limen prover.** Waiting on the owner's Linux host.
- **The proving benchmark.** Harness written and exercised end to end; every attempt so
  far reached real proving and was killed by Cloudflare's 12 GiB ceiling.

### Not started

Demo video, `docs/THREAT_MODEL.md` and the other `docs/` pages, clean-room
reproduction run, filing the two upstream reports.
