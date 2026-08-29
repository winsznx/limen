# @limenlabs/sdk

Prove you can put up the money, without showing how much money you have.

Limen lets a Starknet application require a capital threshold without asking anyone to
reveal their total shielded balance. This package is how you talk to it: derive
challenges and subjects, plan a clearance, and verify a published one from chain.

Live on Starknet Mainnet. Apache-2.0.

```sh
npm install @limenlabs/sdk
```

## What it does

Limen does not prove a balance. It requires the capital to be *mobilised*: exactly the
threshold leaves the subject's private notes, passes through the Limen Anonymizer,
triggers the application's action, and returns to a shielded note, all in one atomic
transaction.

The claim is not "I have T", it is "I just moved T". It is single-use, consumed on chain,
and a revert anywhere moves no capital and leaves the challenge unused.

Your application learns the one condition it asked about and nothing else. Not the
balance, not the other notes, not the address.

## Issuing a challenge

A challenge names the token, the threshold, your contract, the action, and the subject it
binds to. The identifier is derived, so both sides can compute it independently and
compare before anything is spent.

```ts
import { computeChallengeId, deriveSubject, randomNonce } from "@limenlabs/sdk";

const subject = deriveSubject(userAddress, viewingKey, ANONYMIZER);

const params = {
  token: STRK,
  threshold: 4_000000000000000000n,
  target: MY_GATE,
  action: "REGISTER_ALLOCATION",
  subject,
  issuer: MY_ADDRESS,
  expiresAt: Math.floor(Date.now() / 1000) + 6 * 3600,
  nonce: randomNonce(),
};

const challengeId = computeChallengeId(chainId, ANONYMIZER, params);
```

`deriveSubject` produces a pseudonym scoped to one anonymizer. It contains no address,
differs at every other anonymizer, and cannot be produced without the private viewing
key.

A challenge with subject zero is a bearer challenge, clearable by anyone who can raise
the threshold. Bind the subject unless you specifically want that.

## Verifying a clearance

Rebuilds the mechanism from pool and contract events. It trusts nothing this SDK
produced, which is what makes it worth running.

```ts
import { verifyClearanceTransaction } from "@limenlabs/sdk";

const result = await verifyClearanceTransaction(provider, txHash, {
  poolAddress: POOL,
  anonymizerAddress: ANONYMIZER,
  targetAddress: MY_GATE,   // optional: also require your own event
});
```

## Planning a clearance

For the subject's side. It refuses early rather than letting anyone pay a fee for a
transaction that cannot succeed: a consumed challenge, an expired one, a subject
mismatch, or notes that do not cover the threshold.

```ts
import { buildClearancePlan, LimenReadClient } from "@limenlabs/sdk";

const client = new LimenReadClient({ provider, deployment });
const challenge = await client.getChallenge(challengeId);

const plan = buildClearancePlan({
  challenge,
  subject,
  anonymizer: ANONYMIZER,
  noteRecipient: myAddress,
  provingBlockId,
  poolFee,
  tokenSymbol: "STRK",
});
```

Executing the plan needs the STRK20 privacy SDK, which is not on npm. See the
integration guide.

## The application side

Your contract implements one function and enforces its own rules inside it. A challenge
is not an authorisation: anyone can create one, so a gate that trusts whatever the
clearance says can be lowered by a cheaper challenge.

```cairo
limen_shared = { git = "https://github.com/winsznx/limen.git" }
```

```cairo
fn limen_execute(ref self: ContractState, clearance: LimenClearance) {
    assert(get_caller_address() == self.limen.read(), 'CALLER_NOT_LIMEN');
    assert(clearance.action == MY_ACTION, 'WRONG_ACTION');
    assert(clearance.token == self.token.read(), 'WRONG_TOKEN');
    assert(clearance.amount >= self.min_amount.read(), 'BELOW_MIN');
}
```

The caller check is the load-bearing one. Without it anyone can call `limen_execute`
directly with a fabricated struct.

## What this does not give you

- **Not proof of solvency.** Borrowed capital satisfies it exactly as owned capital does.
- **Not identity.** The subject is a pseudonym and tells you nothing else.
- **Not free.** A clearance costs roughly 8.9 STRK on mainnet, a flat 6 STRK pool fee
  plus gas. Sized for high-value gates, not micro-gating.
- **Not clearable from a browser wallet.** Subject binding needs the pool's
  `ComputeAndInvoke` action, which the Wallet API does not expose. Filed upstream as
  [types-js#77](https://github.com/starknet-io/types-js/issues/77).

## Documentation

[Integration guide](https://github.com/winsznx/limen/blob/main/docs/INTEGRATING.md) ·
[Architecture](https://github.com/winsznx/limen/blob/main/ARCHITECTURE.md) ·
[Threat model](https://github.com/winsznx/limen/blob/main/docs/THREAT_MODEL.md) ·
[Repository](https://github.com/winsznx/limen)
