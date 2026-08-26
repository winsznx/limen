# Three-minute demo script

Everything shown is real: live mainnet reads, real transaction hashes, real verifier
output. Nothing is staged, and no number on screen is invented.

Two rules while recording. Never show `.env.local` or a terminal that has echoed a
secret. Never claim a capability on screen that the repository does not back.

---

## 0:00 — 0:20 · The problem

**Screen:** the landing page, <https://limen.timjosh507.workers.dev>

> An application needs to know whether you have enough capital. Normally that means
> showing it a wallet — and everything in it.

Scroll so the hero panel is centred. Point at the balance field.

> This is Limen's actual interface. The requirement is on the left. Where a balance
> would normally sit, it says *not disclosed* — because Limen never learns it.

---

## 0:20 — 0:50 · The mechanism

**Screen:** scroll to the four-step strip.

> One atomic transaction. Spend private notes. Withdraw exactly the threshold to the
> Limen Anonymizer. The bound action runs. The capital returns to a shielded note.

> If you can't supply the threshold, nothing clears. If a revert happens anywhere, no
> capital moves and the challenge stays unused.

**Screen:** the privacy boundary section.

> Stated precisely, because a vague privacy claim is worse than none. The threshold and
> the target are public. The balance, the notes, and the address are not.

Hold briefly on the third column.

> And this is what reduces privacy anyway. It's on the landing page, not buried.

---

## 0:50 — 1:25 · Proving infrastructure

**Screen:** `/console`.

> Limen runs its own proving. This is the pinned upstream STRK20 prover on a dedicated
> host — not in a Worker, because a proof takes minutes of a whole machine.

Point at the image reference.

> Pinned by digest. Though we had to rebuild it: the published image is compiled for one
> CPU family and dies with an illegal-instruction fault on ordinary hardware. That's one
> of three issues we filed upstream.

Point at latency.

> Real numbers from real proofs. Nothing here is a placeholder — when the prover is down
> this page says unreachable rather than showing a green light.

---

## 1:25 — 2:15 · The mainnet clearance

**Screen:** terminal, pre-typed but not yet run:

```sh
node --experimental-strip-types scripts/verify-mainnet.ts \
  0x6e597fbed2be9e4d829f62d456bf762c69a6845add766deecfebbda725dd4aa
```

> This is the transaction the whole project is about. It's on Starknet Mainnet. This
> script doesn't trust anything Limen produced — it re-reads the receipt and rebuilds
> the mechanism from the pool's own events.

**Run it.** Let the checks print.

> Pool touched. Anonymizer invoked through compute-and-invoke. Challenge cleared. The
> target action executed. Capital returned to a shielded note.

Point at the last line.

> And this one matters most. An ERC-20 balance carries no provenance, so the contract
> can't prove the capital came from private notes. The pool publishes what it withdrew,
> so we check that instead — and it matches the threshold exactly. That's a limitation we
> found in our own design, wrote up, and made measurable rather than quietly dropped.

**Screen:** Voyager, the same hash. Show it succeeded.

---

## 2:15 — 2:40 · Failure is a first-class state

**Screen:** terminal.

```sh
node --experimental-strip-types scripts/run-campaign.ts
```

> A hundred deterministic adversarial cases. Below-threshold, replays, expired, wrong
> target, wrong token, wrong subject, direct-call bypass.

Let it finish.

> Zero false clearances. Zero successful replays. Zero funds stranded. Every adversarial
> case asserts the exact error it must fail with, so failing for the wrong reason counts
> as a failure.

---

## 2:40 — 3:00 · Close

**Screen:** `/evidence`.

> Every claim maps to an artefact you can regenerate. Contracts, transactions, the
> campaign, and the ledger.

**Screen:** the GitHub repository.

> Open source, Apache-2.0. The contracts have no owner, no admin and no upgrade path.
> Three upstream issues filed along the way, each with a reproduction.

> Limen proves a bounded capital condition. Not identity anonymity, not solvency. Prove
> enough, keep the rest private.

---

## Preparation

```sh
./infra/fly/session.sh up          # so /console is genuinely live
pnpm --filter @limen/sdk build
```

Have two terminals ready with the commands typed but unexecuted. Set the font large
enough to read at 720p.

Afterwards:

```sh
./infra/fly/session.sh down        # the prover bills while it runs
```

## Things not to say

- "anonymous" or "untraceable" — Limen is pseudonymous, and the boundary is documented
- "proof of solvency" — explicitly not the claim
- "audited" — it is not
- any suggestion a judge can clear a challenge from a browser wallet — the Wallet API
  cannot express compute-and-invoke, which is why we filed types-js#77
