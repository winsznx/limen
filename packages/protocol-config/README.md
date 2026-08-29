# @limenlabs/protocol-config

Live STRK20 pool state, token arithmetic, and the pinned upstream revisions
[Limen](https://github.com/winsznx/limen) is built against.

```sh
npm install @limenlabs/protocol-config
```

Used by [`@limenlabs/sdk`](https://www.npmjs.com/package/@limenlabs/sdk). Useful on its
own if you need pool parameters without the rest of Limen.

## Everything governance can change is read from chain

The pool fee is not a constant. It is governance-controlled, and it was 6 STRK on mainnet
when the docs still said 4. Hardcoding it means a transaction that reverts for a reason
the caller cannot see, so this package reads it live.

```ts
import { MAINNET, readPoolState } from "@limenlabs/protocol-config";

const state = await readPoolState(provider, MAINNET);
// version, classHash, feeAmount, feeCollector, proofValidityBlocks, blockNumber, readAt
```

`provingBlockId(provider)` returns a settled block to anchor a proof to, kept back from
the head so a reorg cannot invalidate a proof between generation and submission.

`isOpenNoteDepositorBlocked(...)` checks the pool's governance denylist before a run,
rather than discovering it as a revert.

## Token amounts, in integers only

No floats anywhere. A float cannot represent 18 decimals without losing value, and
losing value silently is the worst failure mode a token library has.

```ts
import { parseAmount, formatAmount, STRK_MAINNET, findToken } from "@limenlabs/protocol-config";

parseAmount("4.5", STRK_MAINNET.decimals);   // 4500000000000000000n
formatAmount(4500000000000000000n, 18);      // "4.5"
```

## Networks and pins

`MAINNET` and `SEPOLIA` carry the chain id, pool address, and explorer URL builders for
transactions, contracts and classes.

`UPSTREAM_PINS` records the exact upstream revision Limen is built against, including the
pool source commit and the class hash deployed at the mainnet pool. Those two are checked
against each other in CI: if the pinned source stops compiling to the deployed class,
every protocol assumption above it is suspect and the build fails rather than continuing.

Apache-2.0 · [Repository](https://github.com/winsznx/limen)
