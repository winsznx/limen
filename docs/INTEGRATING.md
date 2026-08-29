# Integrating Limen

Two audiences. An **application** that wants to gate an action on capital, and a
**subject** who wants to clear a challenge. Both are covered here, application first,
because that is the side with work to do.

Everything below is backed by code in this repository. Where something is not possible
yet, it says so rather than describing an intended API.

---

## What you are integrating

Limen answers one question for you: *did this subject mobilise at least T of token X?*

It answers it without telling you their balance, which other notes they hold, or their
address. What you get is a pseudonym scoped to your Limen deployment, and the guarantee
that the capital genuinely moved through the STRK20 pool in the same transaction that
called you.

You do not need to understand proving, notes, or nullifiers to consume it. You implement
one function.

---

## Installing

Two halves, because a Limen integration is part Cairo and part TypeScript.

**The Cairo interface**, for your gate contract. A git dependency, no registry needed:

```toml
[dependencies]
limen_shared = { git = "https://github.com/winsznx/limen.git" }
```

That gives you `ILimenTarget`, `LimenClearance`, and the challenge types. It resolves and
compiles today against the public repository.

**The TypeScript SDK**, for issuing challenges and verifying results:

```sh
npm install @limenlabs/sdk
```

Published on npm, along with `@limenlabs/protocol-config` and `@limenlabs/proving-core`,
which it pulls in for you. Nothing in the SDK depends on this repository's layout.

---

## For an application

### 1. Implement the target interface

One entry point, and Limen calls it with a clearance it has already verified.

```cairo
use limen_shared::target::{ILimenTarget, LimenClearance};

#[starknet::contract]
mod MyGate {
    #[abi(embed_v0)]
    impl LimenTargetImpl of ILimenTarget<ContractState> {
        fn limen_execute(ref self: ContractState, clearance: LimenClearance) {
            // clearance.subject    pseudonym, stable for this subject at this anonymizer
            // clearance.token      the token that moved
            // clearance.amount     what actually arrived, measured on chain
            // clearance.action     the action the challenge bound
            // clearance.challenge_id
        }
    }
}
```

Limen never accepts a caller-supplied selector, so a challenge can only ever cause
`limen_execute` to run on the target it names. That is what stops the anonymizer being
usable as a general-purpose call proxy while it is holding capital.

### 2. Enforce your own rules anyway

This is the part that is easy to get wrong. **A challenge is not an authorisation.**
Anyone can create one, because creating one is permissionless and authorises nothing on
its own. If your gate trusts whatever the clearance says, a cheaper challenge lowers your
bar.

So check, independently, every time:

```cairo
assert(get_caller_address() == self.limen.read(), 'CALLER_NOT_LIMEN');
assert(clearance.action == MY_ACTION, 'WRONG_ACTION');
assert(clearance.token == self.token.read(), 'WRONG_TOKEN');
assert(clearance.amount >= self.min_amount.read(), 'BELOW_MIN');
```

The caller check is the load-bearing one. Without it anybody can call `limen_execute`
directly with a fabricated struct. The 100-case campaign includes direct-call cases for
exactly this reason.

`contracts/packages/limen_capital_gate/src/capital_gate.cairo` is a complete worked
example and is the contract deployed at
[`0x10004102…`](https://voyager.online/contract/0x10004102d54305e99a6c7da1c795c785ae21800577634d9f5b1995dc6e25b0c)
on mainnet.

### 3. Issue challenges

A challenge names the token, the threshold, your contract, the action, and the subject it
is bound to. Its identifier is derived, so both sides can compute it independently and
compare before anything is spent.

```ts
import { computeChallengeId, deriveSubject, randomNonce } from "@limenlabs/sdk";

const params = {
  token: STRK,
  threshold: 4_000000000000000000n,
  target: MY_GATE,
  action: "REGISTER_ALLOCATION",
  subject: deriveSubject(userAddress, viewingKey, ANONYMIZER),
  issuer: MY_ADDRESS,
  expiresAt: Math.floor(Date.now() / 1000) + 6 * 3600,
  nonce: randomNonce(),
};

const challengeId = computeChallengeId(chainId, ANONYMIZER, params);
```

Bind the subject unless you genuinely want a bearer challenge. A bearer challenge (subject
zero) can be cleared by anybody who can raise the threshold, which is occasionally what
you want and usually not.

Expiry is checked against the executing block, so a proof generated before expiry still
fails if it lands after. Leave real headroom.

### 4. Read the result

The allocation is your own contract's state. Limen holds nothing on your behalf, and there
is no Limen API to ask. If you want to confirm a specific transaction really did what it
claims, `verifyClearanceTransaction` rebuilds the mechanism from pool and contract events
without trusting the SDK that produced it:

```ts
import { verifyClearanceTransaction } from "@limenlabs/sdk";

const result = await verifyClearanceTransaction(provider, txHash, {
  poolAddress: POOL,
  anonymizerAddress: ANONYMIZER,
  targetAddress: MY_GATE,   // optional: also require your own event
});
```

---

## For a subject

### What you need first

- A registered STRK20 account with at least the threshold **shielded**
- The pool fee and gas in your **public** balance, both paid from there
- Access to a transaction prover

Measured on mainnet, a clearance costs about **8.9 STRK** from the public balance: a flat
6 STRK pool fee plus roughly 2.9 STRK of gas. The threshold itself is not a cost. It is
spent and credited straight back to a shielded note, which is the whole mechanism.

### Clearing

There is no `limen` binary. Clearing runs through the SDK:

```ts
import { buildClearancePlan, LimenReadClient, deriveSubject } from "@limenlabs/sdk";

const client = new LimenReadClient({ provider, deployment });
const challenge = await client.getChallenge(challengeId);
if (!challenge) throw new Error("no such challenge");

const plan = buildClearancePlan({
  challenge,
  subject: deriveSubject(myAddress, viewingKey, ANONYMIZER),
  anonymizer: ANONYMIZER,
  noteRecipient: myAddress,   // where the capital returns
  provingBlockId,             // a settled block, head minus a margin
  poolFee,                    // read from live pool state, never hardcoded
  tokenSymbol: "STRK",
});
```

`buildClearancePlan` refuses early rather than letting you pay a fee for a transaction
that cannot succeed: a consumed challenge, an expired one, a subject mismatch, or notes
that do not cover the threshold each fail before anything is submitted.

`scripts/mainnet-clearance.ts` is a complete working example, and is the script that
produced every published mainnet clearance.

### You cannot do this from a browser wallet

Subject binding needs the pool's `ComputeAndInvoke` action. The Wallet API (0.10.3)
exposes four STRK20 actions and none of them is compute-and-invoke, so `identity_key` (the
only unforgeable, address-free user identity in STRK20) is unreachable from every
wallet-based dapp.

This is an upstream gap, not a design choice, and it is filed as
[types-js#77](https://github.com/starknet-io/types-js/issues/77). Until it closes, clearing
needs a client that holds the keys directly.

---

## Choosing a threshold

Two things to weigh.

**A distinctive threshold fingerprints the user.** Asking for 4.7391 STRK narrows the
anonymity set to almost nothing. Prefer round numbers, and prefer thresholds that many
subjects will share.

**A threshold is disclosed on purpose.** The verifier learns it, and so does anyone
reading the chain. That is the deliberate trade: one number becomes public so the balance
does not have to.

---

## What Limen does not give you

Worth being clear before you build on it.

- **Not proof of solvency.** It proves capital can be mobilised, not that it is owned net
  of liabilities. Borrowed capital satisfies it exactly as owned capital does.
- **Not identity.** The subject is a pseudonym. It is stable for one subject at one
  anonymizer and tells you nothing else.
- **Not a guarantee the capital was private.** An ERC-20 balance carries no provenance, so
  a subject can transfer publicly to the anonymizer between the proving base and
  execution. The capital condition still holds. Whether it came from shielded notes is
  publicly checkable per transaction rather than enforced on chain. See
  [DECISIONS.md](../DECISIONS.md) D-007.
- **Not cheap.** At roughly 8.9 STRK a clearance, this is for high-value gates, not
  micro-gating.
