# Three-minute demo

Everything shown is real: live mainnet reads, real transaction hashes, real verifier
output. Nothing is staged, and no number on screen is invented.

Two rules while recording. Never show `.env.local` or a terminal that has echoed a
secret. Never claim a capability on screen that the repository does not back.

---

## Before you record

**Bring the prover up.** `/console` says *Unreachable* when it is down, which is honest
but makes the proving section fall flat. It costs about $0.31/hour and takes ~2 minutes
to boot.

```sh
./infra/fly/session.sh up
```

**Warm the commands.** Both live commands are fast, but the first run of anything pays
for a cold module cache. Run each once before recording:

```sh
node --experimental-strip-types scripts/verify-mainnet.ts \
  0x2277d769273da51bcc30a5ac41d0bb3fc45906a0a59917202d22f83d383e566   # ~1.5s
node --experimental-strip-types scripts/run-campaign.ts                # ~1.3s
```

Naming a hash scopes the verifier to that transaction and leaves `strk20.json` alone, so
running it on camera cannot disturb the submission manifest.

**Set the stage.** 1920×1080, browser at 100% zoom with bookmarks hidden, terminal font
large enough to read at 720p, both commands typed but unexecuted in separate tabs. Close
anything with a notification badge.

**Do not attempt a live clearance.** A proof takes 50–80 seconds, which is half the
video, and the pool charges a flat 6 STRK fee from the public balance that would need
topping up first. Verifying an existing clearance from chain is both faster and a
stronger claim: it proves the transaction is real without trusting anything Limen built.

---

## 0:00 — 0:20 · The problem

**Screen:** the landing page, <https://limen.timjosh507.workers.dev>

> An application needs to know whether you have enough capital. Normally that means
> showing it a wallet, and everything in it.

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

## 0:50 — 1:15 · Proving infrastructure

**Screen:** `/console`.

> Limen runs its own proving. This is the pinned upstream STRK20 prover on a dedicated
> host, not in a Worker, because a proof takes minutes of a whole machine.

Point at the image reference.

> Pinned by digest. Though we had to rebuild it: the published image is compiled for one
> CPU family and dies with an illegal-instruction fault on ordinary hardware. That's one
> of three issues we filed upstream.

Point at latency.

> Real numbers from real proofs. When the prover is down this page says unreachable
> rather than showing a green light.

---

## 1:15 — 2:10 · The mainnet clearance

**Screen:** terminal, pre-typed but not yet run:

```sh
node --experimental-strip-types scripts/verify-mainnet.ts \
  0x2277d769273da51bcc30a5ac41d0bb3fc45906a0a59917202d22f83d383e566
```

> This is what the whole project is about, on Starknet Mainnet. This script doesn't trust
> anything Limen produced. It re-reads the receipt and rebuilds the mechanism from the
> pool's own events.

**Run it.** Let the checks print.

> Pool touched. Anonymizer invoked through compute-and-invoke. Challenge cleared. The
> target action executed. Capital returned to a shielded note.

Point at the last line.

> And this one matters most. An ERC-20 balance carries no provenance, so the contract
> can't prove the capital came from private notes. The pool publishes what it withdrew,
> so we check that instead, and it matches the threshold exactly. That's a limitation we
> found in our own design, wrote up, and made measurable rather than quietly dropped.

**Screen:** Voyager, the same hash. Show it succeeded.

> Three of these have cleared on mainnet. All three pass every check.

---

## 2:10 — 2:35 · Failure is a first-class state

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

## 2:35 — 3:00 · Close

**Screen:** `/evidence`.

> Every claim maps to an artefact you can regenerate. Contracts, transactions, the
> campaign, and the ledger. Every address and hash on the site links to the explorer.

**Screen:** the GitHub repository.

> Open source, Apache-2.0. The contracts have no owner, no admin and no upgrade path.
> Three upstream issues filed along the way, each with a reproduction.

> Limen proves a bounded capital condition. Not identity anonymity, not solvency. Prove
> enough, keep the rest private.

---

## Afterwards

```sh
./infra/fly/session.sh down        # the prover bills while it runs
```

Then publish the video and put its URL in `strk20.json` under `demo_video`. That field is
what the panel reads, and it is the last thing on the manifest.

## Things not to say

- "anonymous" or "untraceable" — Limen is pseudonymous, and the boundary is documented
- "proof of solvency" — explicitly not the claim
- "audited" — it is not
- any suggestion a judge can clear a challenge from a browser wallet — the Wallet API
  cannot express compute-and-invoke, which is why we filed types-js#77
