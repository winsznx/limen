# Threat model

What Limen defends, against whom, and where it does not. Anything not enforced by code
is stated as not enforced, rather than described in a way that sounds enforced.

Companion to [SECURITY.md](../SECURITY.md), which states the operational rules. This
document is about adversaries.

---

## System boundary

```
  subject's client                    Limen operator                 public
  ────────────────                    ─────────────                  ──────
  signing key                         prover host                    Starknet
  viewing key          ── proof ──►   gateway            ── tx ──►   STRK20 pool
  note witnesses                      web app                        anonymizer
                                                                     target app
```

Trust is not uniform across that diagram, and the differences are the point:

| Component | Holds key material | Can fabricate a clearance |
| --- | --- | --- |
| Subject's client | signing + viewing key | no — the pool enforces the capital flow |
| Limen Prover | sees the viewing key in calldata | no — it produces proofs, it cannot mint state |
| Limen Gateway | sees proving requests | no |
| Limen web app | nothing | no |
| Limen Anonymizer | nothing | no — immutable, no admin, no privileged path |
| STRK20 pool | pool state | out of scope, trusted |
| Starknet | consensus | out of scope, trusted |

**Nothing Limen operates can produce a valid clearance without the subject's own
pool-mediated capital flow.** That is the single most important property, and it is
structural: the anonymizer's clearing entry point accepts calls only from the pinned
pool, and it has no owner, no admin, no pause, no upgrade and no sweep.

---

## Assets, by what losing them costs

| Asset | Where | Consequence if lost |
| --- | --- | --- |
| Subject's signing key | subject's client | full account compromise, outside Limen |
| Subject's viewing key | client; **reaches the prover in calldata** | past and future private activity readable |
| Note witnesses | client, and the proof | linkability of specific notes |
| Threshold capital, in flight | anonymizer, within one transaction | bounded by one challenge's threshold |
| Challenge state | anonymizer storage | public by design; nothing to lose |
| Deployment key | `.env.local`, chmod 600 | ability to deploy, not to forge clearances |
| Gateway token | Fly secret + `.env.local` | free use of proving capacity |
| RPC URL | Fly secret | quota theft; it is a credential |

---

## Adversaries

### A1 — Subject below the threshold

*Wants a clearance without the capital.*

Cannot get one. The amount is **measured on chain**, as the anonymizer's balance delta
against a snapshot the proof carries, and required to equal the threshold exactly. There
is no calldata field asserting the amount, so there is nothing to lie about.

Verified: `below_threshold_capital_cannot_clear`, plus 20 campaign cases. Confirmed on
mainnet — both clearances show `Withdrawal.amount == threshold`.

### A2 — Replay attacker

*Resubmits a cleared challenge.*

Consumption is on chain and checked in **both** legs. The proving leg rejects a consumed
challenge before a proof is generated, so a replay never reaches mainnet or costs a pool
fee; the execution leg rejects it again.

Verified: `a_consumed_challenge_cannot_be_replayed`,
`a_consumed_challenge_is_rejected_before_proving`, 10 campaign cases.

### A3 — Malicious verifier

*Issues a challenge naming an application that never opted in.*

The target checks that the caller is **its own** Limen deployment, so a challenge
pointed at someone else's application is refused by that application. The issuer is
bound into the challenge identifier, so a challenge cannot be attributed to a verifier
that did not open it.

Verified: `run_wrong_target` × 10, `a_target_rejects_a_clearance_that_did_not_come_from_limen`.

### A4 — Malicious target

*Tries to keep the capital it is told about.*

It is told an amount; it is never approved for one. The anonymizer approves only the
pool, only for the measured amount, and only after the target call returns. A target
that tries to pull funds fails on allowance.

A target that reverts aborts the whole transaction: no capital moves, and the challenge
stays unconsumed. Verified: `a_target_cannot_spend_the_capital_it_is_told_about`,
`no_capital_is_stranded_when_the_target_reverts`.

### A5 — Griefing donor

*Transfers tokens to the anonymizer to disrupt clearances.*

Exact equality means a donation causes a **revert, not a false clearance**. The donation
is then permanently locked, since the anonymizer has no sweep. So the attack costs the
attacker the full donation and buys one reverted transaction.

This is a deliberate trade: a sweep would create a way to change the contract's balance
between the proving snapshot and execution, which is a stronger lever than the one it
would remove. DECISIONS.md D-006.

### A6 — Subject substituting public capital

*Publicly tops the anonymizer up so less private capital is needed.*

**This works, and it is the disclosed boundary.** An ERC-20 balance carries no
provenance, and between the proving base and execution anyone can transfer to the
anonymizer. The capital condition still holds in full — a subject who cannot raise the
threshold still cannot clear — but the contract does not enforce that every unit came
from shielded notes.

It cannot be closed on chain; every avenue was checked against the deployed pool class.
DECISIONS.md D-007.

It is **measured instead**. The pool publishes `Withdrawal{to_addr, token, amount}` in
the same transaction:

```
Withdrawal.amount == threshold  →  entirely from private notes
Withdrawal.amount <  threshold  →  the difference was public
```

`scripts/verify-mainnet.ts` asserts this on every published hash and refuses any that
fails. Both mainnet clearances pass.

### A7 — Compromised prover operator

*Reads what passes through the prover.*

**Real exposure, not mitigated by cryptography.** A proving request contains the
subject's signed transaction, and STRK20 client-action calldata contains the private
viewing key — the pool needs it to compile actions inside the proof. There is no
zero-knowledge relationship between client and prover, and Limen does not claim one.

What the operator can do: read the viewing key, and therefore that subject's private
activity. What they cannot do: spend, forge a clearance, or alter the outcome — a proof
attests to an execution, it does not authorise one.

Reduced, not removed:

- no request content reaches a log, metric, error or job record, enforced in code and
  covered by `packages/proving-core/src/redact.test.ts`
- nothing is persisted; the ledger holds counters, durations and outcomes only
- egress is narrowed to the RPC host, so a compromised dependency has nowhere to send it
- the prover publishes no port and is reachable only from the gateway

**If you do not operate the prover, you are trusting whoever does, with your viewing key,
for the duration of the request.** Run your own: `infra/prover/`.

### A8 — Compromised edge worker

*Serves wrong data from the web app.*

The app holds no signing key and cannot mint a clearance. Worst case is misinformation:
a wrong challenge shown, a wrong status reported. Correctable by verifying on chain,
which `verify-mainnet.ts` does without trusting the app at all.

### A9 — Front-runner

*Reorders around a clearance.*

Starknet has no public mempool, so a pending clearance is not observable. The challenge
is single-use and subject-bound, so seeing one does not let anyone else use it.

The one ordering-sensitive window is A6's, and it requires the subject's cooperation.

### A10 — Denial of service

*Exhausts proving capacity.*

Bearer token on every proving request, bounded concurrency, admission control that
refuses rather than queues without limit, and idempotency so retries do not multiply
cost. Validation runs before the prover is touched, so a malformed payload cannot occupy
the single proving slot.

Residual: a valid token holder can saturate the prover. Adequate for a single-operator
deployment, not for a public service.

### A11 — RPC inconsistency

*The node lies or lags.*

A wrong answer to a read produces a wrong proof, which the pool rejects. Proving is
anchored to a settled block rather than the head, so a reorg cannot invalidate a proof
between generation and submission.

Not defended: a node that consistently lies about state could cause proofs that always
fail. That is availability, not correctness.

### A12 — Dependency compromise

*Malicious code in the supply chain.*

The prover image is pinned by digest and rebuilt from a commit the published image names
in its own labels. The pool class is verified to match the revision Limen is built
against, and CI fails if that stops holding. Lockfiles are committed and CI installs
frozen.

Residual: Limen has not audited its dependency tree, and the STRK20 SDK is built from
source at a pinned commit rather than reviewed line by line.

---

## Assumptions

Limen is only as sound as these:

1. **The STRK20 pool behaves as its deployed class specifies.** Verified to be the
   revision Limen is built against; not audited by Limen.
2. **Starknet provides ordering and finality.**
3. **Poseidon and the STARK proof system are sound.**
4. **The subject's client is not compromised.** A compromised client makes everything
   else moot.
5. **The prover operator is honest, or is the subject.** See A7.
6. **The pool's governance does not turn hostile.** It can denylist the anonymizer,
   which would stop clearances — an availability risk, not a correctness one.

---

## What Limen does not claim

- **Not identity anonymity.** The subject is a pseudonym, stable per anonymizer, and
  timing plus a distinctive threshold can narrow who it is.
- **Not proof of solvency.** A point-in-time capital condition says nothing about
  liabilities, and borrowed capital satisfies it exactly as owned capital does.
- **Not audited.** Coverage is thorough and adversarial; that is not an audit.
- **Not upgradeable.** Immutable by design, so a finding means a new deployment and a
  migration, not a patch.
