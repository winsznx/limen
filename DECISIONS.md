# Decisions

Every entry records what was decided, what evidence forced it, and what it costs.
Entries are append-only. When a decision is superseded, the old entry stays and the new
one says so.

---

## D-001 — The deployed mainnet pool is the authority, not the monorepo `main` branch

**Date:** 2026-08-25
**Status:** accepted

`starkware-libs/starknet-privacy@main` is at pool version `2.1`. The class actually
deployed at the STRK20 mainnet pool
`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` is version `2.0`,
class `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`, and
corresponds to the upstream tag `CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08`
(commit `74841caf0466d122117945e28ed983e2864c8fc1`).

The two differ in ways that change what Limen can do, so every protocol assumption is
taken from the deployed ABI, dumped to `evidence/mainnet/pool-abi.json` by
`tools/dump-pool-abi.ts`, and cross-read against the pinned tag's Cairo source.

**Cost:** Limen must be re-verified against the deployed class after any pool upgrade.
`tools/dump-pool-abi.ts` is the check; it runs in CI against mainnet.

---

## D-002 — Open-note deposits are not screened on the deployed mainnet pool

**Date:** 2026-08-25
**Status:** accepted

This decided whether Limen was buildable at all.

On `main` (v2.1), an `Invoke` target that returns open-note deposits carries an
`OpenNoteScreeningPolicy`, defaulting to `Required`, which makes the anonymizer's own
address the transaction's screening subject. A brand-new third-party anonymizer would
therefore need an FPI screening attestation on **every** clearance, obtainable only
through the official proof-interceptor sidecar's Elliptic partner credentials. That
would have made Limen depend on credentials it cannot obtain, and would have triggered
PRD kill criterion 5.

The deployed v2.0 class has no such policy. It exposes
`is_open_note_depositor_blocked(depositor)` / `set_open_note_depositor_blocked` — a
governance denylist — and `_apply_invoke_and_deposits` asserts only
`!blocked_open_note_depositors.read(contract_address)`. No attestation is required for
open-note deposits. `get_open_note_screening_policy` does not exist on chain, and the
pool has never emitted an `OpenNoteScreeningPolicySet` event.

Regular pool deposits (`TransferFrom`) still require a screening attestation on v2.0.

**Consequence, and it is the one that makes the project work:** a Limen *clearance*
contains no `Deposit` action, so it needs no attestation and can be proven end to end
by the Limen self-hosted prover. Only the initial *shielding* deposit needs the
official screening path. The load-bearing transaction is the one Limen proves itself.

**Cost:** when mainnet upgrades to v2.1, Limen's anonymizer will need a policy of
`Exempt` or `Delegated`, or a screening attestation over its own address. Tracked in
README limitations and re-checked by `tools/probe-mainnet.ts` in CI.

---

## D-003 — Limen uses `ComputeAndInvoke`, not the plain `InvokeExternal` path

**Date:** 2026-08-25
**Status:** accepted

The pool's `ComputeAndInvoke` client action calls the target's `privacy_compute` with
`[identity_key, ...compute_additional_data]`, where

```
identity_key = poseidon(IDENTITY_KEY_TAG, user_addr, user_private_key, contract_address)
```

is derived by the pool *inside the proven execution*, from the spender's private
viewing key. The result is bound into the proof and delivered verbatim to
`privacy_invoke_with_computation`.

This is exactly the subject primitive Limen needs, and nothing else in the protocol
provides it:

- unforgeable — deriving it requires the private viewing key,
- stable per (user, anonymizer) — so a verifier can bind a challenge to a subject,
- scoped to one anonymizer — so a Limen pseudonym cannot be correlated across
  deployments,
- address-free — the target never learns who the subject is.

Limen therefore implements **only** `privacy_compute` and
`privacy_invoke_with_computation`. It deliberately does **not** implement
`privacy_invoke`: without a compute leg there is no proof-bound value from before the
withdrawal, and the plain path would be strictly weaker. A plain `Invoke` at the Limen
Anonymizer fails at entry-point resolution, which
`the_plain_invoke_entry_point_does_not_exist` pins.

Verified live: `privacy_invoke_with_computation` is in production use on mainnet today
(see `recent_invoke_targets` in `evidence/mainnet/pool-state.json`).

---

## D-004 — A fixed target selector, never a caller-supplied one

**Date:** 2026-08-25
**Status:** accepted

A challenge binds a `target` address and an `action` felt, and the anonymizer always
calls the fixed entry point `limen_execute(LimenClearance)`.

The obvious alternative — letting the challenge carry an arbitrary selector — would
turn the anonymizer into a general-purpose call proxy at the moment it is holding the
threshold capital, so a challenge could name `approve` or `transfer` on the token
itself. PRD §10.1 forbids exactly that surface. Application-level dispatch belongs in
the target, on an identifier it chooses to recognise.

**Cost:** a target application must implement `ILimenTarget`. That is one entry point,
and it is the same shape for every integration.

---

## D-005 — The capital condition is exact equality, not a lower bound

**Date:** 2026-08-25
**Status:** accepted

`privacy_invoke_with_computation` requires the measured delta to equal the challenge
threshold exactly, rather than merely meeting it.

A lower bound would let the anonymizer return more than it can account for, and would
silently sweep any balance that happened to be sitting in the contract into the
clearing subject's note. Exact equality keeps the anonymizer's resting balance
invariant across every clearance: whatever it held before, it holds after.

`a_pre_existing_stray_balance_neither_helps_an_attacker_nor_blocks_an_honest_clearance`
pins that invariant.

**Cost:** the client must withdraw the threshold precisely. The SDK derives the
withdrawal amount from the challenge rather than from user input, so this is not a
foot-gun in practice.

---

## D-006 — The anonymizer has no owner, no admin, and no recovery path

**Date:** 2026-08-25
**Status:** accepted

`LimenAnonymizer` has one constructor argument (the pool address), no roles, no pause,
no upgrade, and no sweep. There is no code path that records a clearance without the
pool-mediated capital flow, which is the property PRD §12.3 item 9 and §10.1 require.

The deliberate consequence: **tokens transferred directly to the Limen Anonymizer are
permanently locked.** Adding a sweep would introduce a way to change the contract's
balance between the proving snapshot and execution, which is a denial-of-service lever
against honest clearances, in exchange for recovering funds nobody should be sending.
The README, the SECURITY doc and the app all say plainly not to send tokens to the
anonymizer directly.

---

## D-007 — What Limen proves, and the one thing it does not

**Date:** 2026-08-25
**Status:** accepted
**This is the most important entry in this file.**

### What is proven, without qualification

A successful clearance is atomic and requires that **exactly the threshold amount of
the challenge's token was delivered to the Limen Anonymizer and returned to shielded
state in the same transaction**, authorised by a subject who holds the private viewing
key the challenge is bound to. A subject who cannot raise the threshold cannot clear,
by any route. That is the falsifiable claim in PRD §1.4 and it holds.

### The boundary

An ERC-20 balance carries no provenance. The anonymizer measures capital as
`balance_of(self)` at execution minus a snapshot taken by `privacy_compute` at the
proving base. Between those two moments — the proving base is roughly ten blocks back,
so the window is minutes — anyone can publicly transfer the token to the anonymizer,
and that transfer is indistinguishable from the pool's withdrawal.

So a subject holding part of the threshold publicly and the rest privately can clear a
challenge by publicly topping the anonymizer up. The capital condition still holds in
full. What is not enforced *inside the contract* is that all of it came from shielded
notes.

### Why it cannot be closed in the contract

Every avenue was checked against the deployed pool class:

- The pool passes the anonymizer no protocol-derived record of the withdrawal amount;
  the invoke calldata is entirely user-supplied apart from the compute result.
- The balance-delta idiom the upstream helpers use is sound because their delta
  brackets an external call whose output the protocol produces (see the Ekubo
  anonymizer). Limen's input token arrives *before* the invoke, so no in-call bracket
  exists for it.
- `privacy_compute` runs in the proven virtual execution at the proving base, not on
  chain, so it cannot snapshot at execution time.
- Moving the withdrawal to a separate address, an unpredictable per-challenge escrow,
  or a target that round-trips the capital all reduce to the same measurement.
- The pool allows at most one invoke-phase action per transaction, so a second
  measuring leg is unavailable.

This is a property of the STRK20 open-note pattern rather than of Limen, and it applies
to any anonymizer that measures across the pool's withdraw leg. It is being reported
upstream; see CONTRIBUTIONS.md.

### What is done about it instead

The pool publishes `Withdrawal { to_addr, token, amount }` in the same transaction, so
the split is public for every clearance:

```
Withdrawal.amount == challenge.threshold   →  the whole threshold came from private notes
Withdrawal.amount <  challenge.threshold   →  the difference was topped up publicly
```

This is not left as a footnote. It is checked:

- `scripts/verify-mainnet.ts` asserts `Withdrawal.amount == threshold` against every
  transaction hash Limen publishes, and fails if it does not hold.
- The explorer surfaces the private-source split per transaction.
- `evidence/claims.json` carries it as claim C9 with the verification command.
- Two contract tests hold the line in both directions:
  `an_honest_clearance_withdraws_the_whole_threshold_from_the_pool` and
  `public_capital_can_substitute_but_the_pool_publishes_the_split`.

The claim was not weakened to route around this. It is stated at the strength the
mechanism actually supports, and the residual is measured rather than described.

---

## D-008 — Deposits use the official proving path; clearances use the Limen prover

**Date:** 2026-08-25
**Status:** accepted

A regular pool deposit requires a `ScreeningAttestation` signed by the configured
screener key, which reaches the SDK as `additional_data.signature` on the prove
response. Only the official proving deployment runs the proof-interceptor sidecar with
the Elliptic partner credentials that produce it, and those credentials cannot be
self-issued.

A Limen clearance contains no `Deposit` action — it is `UseNote`, `CreateOpenNote`,
`Withdraw`, `ComputeAndInvoke` — so it requires no attestation, and the Limen
self-hosted prover can produce a mainnet-accepted proof for it on its own.

Limen therefore shields through the official path once, at setup, and proves every
clearance itself. The transaction the product is actually about is the one Limen
proves, which is what makes the proving subsystem load-bearing rather than decorative.

---

## D-009 — Mirrored protocol types rather than a dependency on the `privacy` package

**Date:** 2026-08-25
**Status:** accepted

`OpenNoteDeposit` is redeclared in `limen_shared::objects` instead of importing
`privacy::objects`. Depending on the upstream Cairo package would pull Ekubo,
`starkware_utils`, `starkware_accounts` and the whole pool contract into Limen's build
for one three-field struct, and would pin Limen to a source revision rather than to the
class that is actually deployed.

The mirror is only safe if it is pinned, so it is:
`open_note_deposit_serializes_to_three_felts_in_pool_order` asserts the exact wire
format, and the `MockPool` fixture deserializes Limen's return value with the same
`Serde::deserialize` plus trailing-data assertion the pool performs.

---

## D-011 — The Limen Prover runs on a dedicated Linux host, not on Cloudflare

**Date:** 2026-08-25
**Status:** accepted, after measurement
**Supersedes:** the first attempt, which ran the prover on Cloudflare Containers

The web application deploys to Cloudflare Workers through Wrangler, as intended. The
prover does not, because it measurably cannot.

Cloudflare Containers cap at `standard-4`: 4 vCPU, 12 GiB memory, 20 GB disk, and
custom instance types are bounded by the same ceiling. The pinned prover image was
deployed there and reached a healthy state, reporting spec `0.10.3-rc.2`. It could not
finish a proof. Across five distinct replayed mainnet transactions the container was
killed 21–29 seconds into proving with `Container suddenly disconnected`, and the
behaviour did not change with `PREFETCH_STATE=false` and
`COMPILED_CLASS_CACHE_SIZE=32` — so the memory belongs to the Stwo prover core, not to
tunable caches.

For scale: upstream recommends a 48 vCPU / 96 GB machine, and the STRK20 skill cites
roughly 29 seconds on 12 cores and 46 GiB. 12 GiB is about a quarter of the smallest
configuration anyone reports working.

So the prover, the gateway and a Cloudflare Tunnel run under `docker compose` on a
Docker-capable x86_64 Linux host (`infra/prover/`). This is what the PRD's own
architecture describes, and it is a better fit than the Worker version was:

- the gateway sits beside the prover, so admission control is genuinely serialised in
  one process rather than coordinated through a Durable Object,
- the prover publishes no port at all and is reachable only across the private compose
  network,
- the tunnel is the only inbound path, and it terminates at the gateway.

`infra/prover/setup.sh` refuses to start on a host with less than 24 GB of RAM or on a
non-x86_64 machine, because both failures otherwise surface as a proof dying partway
through with a message that mentions neither memory nor architecture.

**Cost:** one machine to operate, and a tunnel to keep alive. The alternative was
abandoning self-hosted proving, which is a core part of the product thesis and a
mandatory acceptance gate.

---

## D-012 — The prover needs an RPC endpoint on spec 0.10.x, and most are not

**Date:** 2026-08-25
**Status:** accepted

The prover re-executes each transaction against a finalized block, and it needs block
data that older RPC spec versions do not carry. Pointed at
`rpc.starknet.lava.build`, which advertises spec `0.10.2`, every proof failed with
`missing field state_diff_commitment` — a message that gives no hint the RPC is at
fault.

Endpoints checked: `lava.build` (0.10.2, fails), `blastapi` (retired, now returns an
error telling callers to move to Alchemy), `free-rpc.nethermind.io` (unreachable),
Alchemy `v0_9` (0.9.0, too old), Alchemy `v0_10` (**0.10.3-rc.0**, matches the
prover's own `0.10.3-rc.2` and works).

Limen therefore requires an Alchemy Starknet Mainnet key on the `v0_10` path. The URL
is treated as a credential: it is passed to the container at start, never baked into
the image, and never logged. `infra/prover/setup.sh` checks the endpoint's spec
version before starting anything, so this surfaces as a clear refusal rather than as a
mid-proof failure.

---

## D-010 — Bearer challenges are supported, and labelled

**Date:** 2026-08-25
**Status:** accepted

A challenge with `subject == 0` may be cleared by any subject, and records whoever
clears it. Subject binding is enforced whenever a subject is named.

Both exist because the two integration routes differ in what they can know. A
key-holding client (the Privacy SDK route) can derive its own Limen subject locally and
hand it to a verifier before a challenge is issued, so those challenges are
subject-bound. A wallet-API dapp never sees the user's viewing key and cannot derive
it, so it cannot pre-commit a subject; those challenges must be bearer.

The UI labels which kind a challenge is rather than hiding the difference, and the
consuming subject is recorded either way, so a target always binds its record to a
pseudonym.
