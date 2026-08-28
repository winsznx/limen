# Security

What Limen protects, from whom, and where the boundaries actually are. Anything not
enforced by code is stated as not enforced, rather than described in a way that sounds
enforced.

Full threat model: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

---

## Reporting

Open a security advisory on the repository, or email the maintainer. Please do not open
a public issue for anything affecting funds or key material.

Limen is hackathon-stage software. It has not been externally audited. The contracts are
immutable with no owner, so there is no upgrade path to patch a deployed instance: a
finding means deploying a new anonymizer and migrating, not fixing in place.

---

## Assets

| Asset | Where it lives | Exposure |
| --- | --- | --- |
| User signing key | the user's wallet or client | never reaches Limen |
| User viewing key | the user's key-holding client | reaches the prover inside proving calldata |
| Shielded notes and witnesses | client memory, and the proof | reach the prover |
| Threshold capital, in flight | the Limen Anonymizer, within one transaction | public amount, private owner |
| Challenge state | the anonymizer's storage | fully public by design |
| Deployment key | `.env.local`, `chmod 600`, gitignored | never printed, never committed |
| Gateway token | a Cloudflare secret and the prover host's `.env` | server-side only |
| RPC URL | a Cloudflare secret and the prover host's `.env` | credential; can carry a key in its path |

---

## Properties the code enforces

Each of these is a test, not a statement. The campaign replays the same shapes at scale
in `evidence/campaigns/security.json`.

| | Property | Enforced by |
| --- | --- | --- |
| 1 | A subject who cannot mobilise the threshold cannot obtain authorization | exact-equality measurement against a proof-bound snapshot |
| 2 | A cleared challenge cannot be replayed | consumed before the external call; rejected in both the proving and execution legs |
| 3 | A challenge cannot be redirected to another target | the anonymizer calls only the bound target, on a fixed entry point |
| 4 | A challenge cannot be retargeted to another action | the action identifier is bound into the challenge id and checked by the target |
| 5 | Another token cannot satisfy a token-specific challenge | snapshot and delta are both taken on the challenge's token; the target checks independently |
| 6 | Expired challenges fail | expiry checked against the executing block, not the proving base |
| 7 | Direct calls cannot bypass the pool | the clearing entry point accepts only the pinned pool; no plain `privacy_invoke` exists |
| 8 | One subject's challenge cannot consume another's funds | per-challenge state; capital measured per transaction |
| 9 | Prover failure cannot mark a clearance successful | clearance state changes only inside the pool transaction |
| 10 | Logs cannot expose witness material | redaction at every emitting boundary, with tests |
| 11 | Duplicate retries cannot double-execute | challenge consumption on chain; idempotency at the gateway |
| 12 | A target revert cannot strand capital | external reverts propagate and abort the whole transaction |
| 13 | No privileged party can fabricate a clearance | no owner, no admin, no pause, no upgrade, no sweep |

### No privileged path

`LimenAnonymizer` takes one constructor argument, the pool address, and exposes no
setter for it. There is no role, no pause, no upgrade and no sweep. Creating a challenge
is permissionless and authorises nothing on its own.

The deliberate consequence: **tokens sent directly to the Limen Anonymizer are
permanently locked.** A sweep would give something a way to change the contract's balance
between the proving snapshot and execution, which is a denial-of-service lever against
honest clearances, in exchange for recovering funds nobody should be sending. Do not
transfer tokens to the anonymizer.

---

## What the prover learns

This is the sharpest edge in the system and it is not softened anywhere in the product.

A proving request contains the user's full signed transaction. For a STRK20 client
action, that calldata **contains the user's private viewing key**, because the pool needs it to
compile client actions inside the proof. There is no zero-knowledge relationship between
the client and the prover, and Limen does not claim one.

So the prover host is treated as holding key material:

- **Never logged.** No request content reaches a log line, a metric label, an error
  string, or a job record. Redaction is applied at every emitting boundary and
  `packages/proving-core/src/redact.test.ts` asserts a viewing key cannot survive
  serialisation, including nested in calldata, inside errors, and past a depth bound.
- **Never persisted.** The gateway ledger is in-memory and holds counters, durations,
  outcomes, and proof results keyed by a client-chosen idempotency key. No calldata, no
  signatures, no witnesses. That is why `/metrics` and `/jobs` are safe to expose.
- **Never in cloud state.** Nothing goes to D1, KV, Durable Object storage, analytics, or
  any external service.
- **Narrow egress.** The prover reaches exactly one host, the RPC node. Everything else is
  refused at the network layer, so a compromised dependency inside the image has nowhere
  to send a witness.
- **Not exposed.** The prover publishes no port. Only the gateway reaches it, and only a
  Cloudflare Tunnel reaches the gateway.

If you do not operate the prover, you are trusting whoever does with your viewing key for
the duration of the request. Run your own: `infra/prover/`.

---

## The disclosed boundary

**An ERC-20 balance carries no provenance.**

The anonymizer measures capital as its balance at execution minus a snapshot taken at the
proving base, roughly ten blocks earlier. In that window anyone can transfer the token to
the anonymizer publicly, and that transfer is indistinguishable from the pool's
withdrawal.

So a subject holding part of the threshold publicly and the rest privately can clear a
challenge by topping the anonymizer up. **The capital condition still holds in full**,
exactly the threshold really was delivered, and a subject who cannot raise it still
cannot clear. What is not enforced *inside the contract* is that every unit came from
shielded notes.

Every avenue to close it was checked against the deployed pool class and none exists;
the reasoning is in [DECISIONS.md](DECISIONS.md) D-007. It is a property of the STRK20
open-note pattern rather than of Limen.

It is measured instead of described. The pool publishes
`Withdrawal{to_addr, token, amount}` in the same transaction:

```
Withdrawal.amount == threshold   →  the whole threshold came from private notes
Withdrawal.amount <  threshold   →  the difference was topped up publicly
```

`scripts/verify-mainnet.ts` asserts this on every transaction Limen publishes and fails
if it does not hold. The explorer surfaces it per transaction. Two contract tests hold
the line in both directions.

---

## Adversaries

| Adversary | What they can do | What stops them |
| --- | --- | --- |
| Below-threshold user | present any calldata they like | the amount is measured on chain, not asserted |
| Replay attacker | resubmit a cleared challenge | consumption is on chain and checked in both legs |
| Malicious verifier | issue a challenge naming someone else's app | the target checks the caller is its own Limen deployment; the issuer is bound into the challenge id |
| Malicious target | try to keep the capital it is told about | it is told an amount, never approved for it |
| Griefing donor | transfer to the anonymizer to disrupt clearances | exact equality means a donation causes a revert, not a false clearance; the donation is permanently locked |
| Front-runner | reorder around a clearance | Starknet has no public mempool; the challenge is single-use and subject-bound |
| Compromised prover operator | read witness material | real exposure, documented above; run your own prover |
| Compromised edge worker | serve wrong data | it holds no signing key and cannot mint a clearance; worst case is misinformation, correctable by verifying on chain |
| Denial of service | exhaust proving capacity | bearer auth, bounded concurrency, admission control, idempotency |

---

## Operational rules

Never committed, never logged, never in cloud state: signing keys, viewing keys,
decrypted note data, proving witnesses.

- Secrets live in `.env.local` (`chmod 600`, gitignored) and in Cloudflare secrets.
- No secret is a `NEXT_PUBLIC_` variable. The RPC URL and gateway token are read
  server-side only.
- The deployment key is generated locally by `tools/new-account.ts`, which prints only
  the address and refuses to overwrite an existing key.
- Container logs are size-capped and rotated.
- The prover gateway requires a bearer token on every proving request. Without it, it
  would be an open proving oracle and anyone could spend the host's capacity.

## Known weaknesses

- **Not audited.** Test coverage is thorough and adversarial, but that is not an audit.
- **Immutable, so unpatchable.** A finding means a new deployment, not a fix in place.
- **Bearer auth only.** The gateway has no per-client identity or rate limiting beyond
  admission control. Adequate for a single-operator deployment, not for a public service.
- **In-memory idempotency.** A gateway restart forgets stored results, so a retry across
  a restart proves again rather than replaying. It costs capacity, never correctness.
- **A single prover.** No redundancy. If the host is down, clearances cannot be produced;
  nothing is lost, and nothing incorrect is produced.
- **Pool upgrades.** Mainnet runs v2.0. Under v2.1 a third-party anonymizer would need a
  screening attestation over its own address, which Limen cannot self-issue.
  `tools/probe-mainnet.ts` re-checks this and CI fails if it changes.
