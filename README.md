# Limen

Applications often need to know whether you have enough capital, which normally means
showing them a wallet and everything in it.

Limen lets a Starknet application require a capital threshold without asking you to
reveal your total shielded balance.

```
  spend                withdraw               execute              return
  ─────                ────────               ───────              ──────
  valid STRK20    →    exactly T to      →    the bound       →   T credited back
  private notes        Limen Anonymizer       target action        to a shielded note

  ──────────────────── one atomic transaction ────────────────────
       a revert anywhere moves no capital and consumes no challenge
```

If you cannot supply the threshold, nothing clears. If you can, the application learns
the one condition it asked about and nothing else: not your balance, not your other
notes, not your address.

**Live demo** — <https://limen.timjosh507.workers.dev>

---

## Status

Limen is mid-sprint and this section is the honest version.

| | |
| --- | --- |
| Protocol map verified against the deployed mainnet pool | done, reproducible |
| Contracts written, audited by tests | 166 Cairo tests passing |
| Adversarial campaign | 100/100 cases as specified, 0 false clearances |
| SDK, prover gateway, web app | 70 TypeScript tests passing, app deployed |
| Contracts deployed to mainnet | not yet, awaiting funding |
| Mainnet clearance through the Limen prover | not yet, awaiting a prover host |

`evidence/claims.json` is the full ledger: every claim, the artefact that proves it, and
the command to regenerate that artefact. Claims that are not yet demonstrated say so and
name what they are waiting on.

## Mainnet evidence

`strk20.json` is empty. It is populated only by `scripts/verify-mainnet.ts`, which
independently re-reads each transaction from chain and refuses any hash whose events do
not reconstruct the whole mechanism. Publishing a hash before that passes would make the
file decorative, so it stays empty until it is not.

What *is* verified on mainnet today:

```sh
node --experimental-strip-types tools/verify-pool-source.ts
```

This compiles the pinned upstream revision and compares the result against the class
actually deployed at the STRK20 pool. They match exactly:

```
upstream commit   74841caf0466d122117945e28ed983e2864c8fc1
computed class    0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d
deployed class    0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d
```

That matters because the monorepo's `main` branch is at pool version 2.1 while mainnet
runs 2.0, and they differ in ways that decide whether a third-party anonymizer can exist
at all. Every interface assumption in Limen is read from the deployed class.

## The privacy boundary

Vague privacy claims are worse than none, so here is the whole thing.

**Becomes public.** The token and threshold being proven. The target application and the
action authorised. The challenge identifier, and that it was consumed. A subject
pseudonym scoped to this anonymizer. That the pool withdrew the threshold and credited it
back. The time it landed.

**Stays private.** Your total shielded balance. How much more than the threshold you
hold. Which notes you spent and their amounts. Your Starknet address, which the target
never receives. Your unrelated shielded activity. Your viewing key and signing key.

**Reduces privacy anyway.** Deposits into and withdrawals out of the pool are public by
protocol design; only movement inside is shielded. Timing correlation can link a
shielding deposit to a later clearance, so shield ahead of time. A distinctive threshold
narrows the anonymity set. The threshold itself is disclosed to the verifier on purpose.

**And one thing Limen does not prove.** An ERC-20 balance carries no provenance. Between
the proving base and execution, a subject can transfer the token to the anonymizer
publicly, and the contract cannot distinguish that from the pool's own withdrawal. The
capital condition still holds — a subject who cannot raise the threshold still cannot
clear — but the contract does not enforce that every unit came from shielded notes.

This cannot be closed on chain, and the reasoning is in [DECISIONS.md](DECISIONS.md)
D-007. It is measured rather than described: the pool publishes
`Withdrawal{to_addr, token, amount}` in the same transaction, so
`Withdrawal.amount == threshold` means the whole amount came from private notes. The
verifier asserts it on every published transaction and the explorer shows it.

Limen proves a bounded capital condition. It is not identity anonymity, and it is not
proof of solvency.

## Run it locally

```sh
git clone https://github.com/winsznx/limen && cd limen
./scripts/bootstrap.sh          # toolchain check, deps, pinned upstream SDK
pnpm test                       # 70 TypeScript tests
cd contracts && snforge test    # 166 Cairo tests
```

Then the evidence, which needs no keys, no funds and no network beyond a public RPC:

```sh
node --experimental-strip-types tools/verify-pool-source.ts   # pinned source == deployed class
node --experimental-strip-types tools/probe-mainnet.ts        # live pool parameters
node --experimental-strip-types scripts/run-campaign.ts       # 100-case adversarial campaign
```

[SETUP.md](SETUP.md) covers the parts that need credentials.

## Architecture

```
browser
   │
   ▼
Limen web ─────────────────► Starknet Mainnet
Cloudflare Workers           STRK20 pool
   │                              │
   │  bearer over Cloudflare      │  privacy_compute
   │  Tunnel                      │  privacy_invoke_with_computation
   ▼                              ▼
Limen Prover Gateway         Limen Anonymizer ──► target application
   │  auth, validation,           │
   │  admission, idempotency,     └──► shielded open note
   │  health, redaction
   ▼
Limen Prover                 dedicated Linux host
pinned upstream image        never inside a Worker
```

| Path | What it is |
| --- | --- |
| [`contracts/`](contracts/) | `LimenAnonymizer` and the reference `CapitalGate`. No owner, no admin, no upgrade path |
| [`packages/limen-sdk/`](packages/limen-sdk/) | Challenge and subject derivation, clearance planning, the transaction verifier |
| [`packages/prover-gateway/`](packages/prover-gateway/) | Everything between a client and the proving binary |
| [`packages/proving-core/`](packages/proving-core/) | The provider seam, retry classification, redaction |
| [`packages/protocol-config/`](packages/protocol-config/) | Live chain reads and the upstream pins |
| [`apps/web/`](apps/web/) | The product, deployed to Cloudflare Workers |
| [`infra/prover/`](infra/prover/) | The prover host: compose, preflight, runbook |

[ARCHITECTURE.md](ARCHITECTURE.md) has the detail.

## Tests and evidence

```
166  Cairo tests            contract invariants, plus the 100-case campaign
 70  TypeScript tests       derivation parity, redaction, retry, admission, amounts
```

Two things are worth singling out.

**Cross-language parity has a shared oracle.** Challenge identifiers are derived
independently in Cairo and TypeScript, and both assert the same pinned constant. If
either implementation changes, exactly one suite goes red. Two implementations agreeing
with each other proves nothing; agreeing with a fixed value does.

**The campaign's oracle is the test runner.** Each of the 100 cases is an independent
test, and every adversarial case asserts the exact error it must fail with, so a case
that fails for the wrong reason counts as a failure rather than a pass.

```json
{ "total": 100, "valid_observed": 25, "invalid_rejected": 75,
  "false_clearances": 0, "successful_replays": 0, "funds_stranded": 0 }
```

## Limitations

- **Contracts are not on mainnet yet.** Everything is written and tested; deployment
  needs funding for the dedicated account.
- **No mainnet clearance yet.** The Limen prover needs a Docker-capable x86_64 host with
  at least 24 GB of RAM. Cloudflare Containers cap at 4 vCPU / 12 GiB, where the prover
  is killed 21–29 s into every proof. Measured, with the raw numbers, in
  [DECISIONS.md](DECISIONS.md) D-011.
- **Clearing needs a key-holding client.** Subject binding requires the pool's
  `ComputeAndInvoke` action, and the Wallet API (0.10.3) exposes four STRK20 actions,
  none of which is compute-and-invoke. So no browser wallet can clear a Limen challenge
  today. This is an upstream gap, written up in [CONTRIBUTIONS.md](CONTRIBUTIONS.md) C-2.
- **Public capital can substitute for private capital.** The disclosed boundary above.
  Publicly checkable per transaction, not prevented on chain.
- **The pool may upgrade.** Mainnet runs v2.0. Under v2.1 a third-party anonymizer would
  need a screening attestation over its own address, which Limen cannot self-issue.
  `tools/probe-mainnet.ts` re-checks this and CI fails if it changes.
- **One reference target.** `CapitalGate` exists to prove Limen can authorise a real
  contract action, not to be a second product.

## Upstream contributions

Two findings from building this, both reproduced and reduced to a minimal case, in
[CONTRIBUTIONS.md](CONTRIBUTIONS.md):

- the published `linux/arm64` prover image aborts with `SIGILL` on generic aarch64,
- the Wallet API cannot reach the pool's `ComputeAndInvoke` path, so the only unforgeable
  address-free user identity in STRK20 is unavailable to the route the docs recommend.

## Documentation

[ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md) ·
[DECISIONS.md](DECISIONS.md) · [BUILD_LOG.md](BUILD_LOG.md) ·
[CONTRIBUTIONS.md](CONTRIBUTIONS.md) · [SETUP.md](SETUP.md) ·
[infra/prover/README.md](infra/prover/README.md)

Apache-2.0.
