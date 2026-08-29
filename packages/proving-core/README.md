# @limenlabs/proving-core

The proving seam used by [Limen](https://github.com/winsznx/limen): one provider
interface, retry classification that only retries what is genuinely transient, and
redaction that keeps viewing-key material out of logs.

```sh
npm install @limenlabs/proving-core
```

Used by [`@limenlabs/sdk`](https://www.npmjs.com/package/@limenlabs/sdk).

## One interface, several provers

A self-hosted prover, a wallet-managed one and a test double are interchangeable, and the
caller can report which produced a given proof.

```ts
import type { LimenProvingProvider } from "@limenlabs/proving-core";

interface LimenProvingProvider {
  readonly kind: ProviderKind;
  readonly name: string;
  health(): Promise<ProviderHealth>;
  prove(request: ProvingRequest): Promise<ProvingResult>;
}
```

## Retry behaviour is derived, not invented

`ProvingError` carries a `retryable` flag classified from the prover's own documented
JSON-RPC codes. Only `busy`, `timeout` and `unavailable` are transient.

A rejected proof or an invalid request fails on the first attempt. Repeating it cannot
change the outcome, and it would burn the scarcest resource in the system: a proof takes
minutes of a whole machine.

```ts
import { withRetry, classifyProverRpcCode } from "@limenlabs/proving-core";
```

## Redaction is enforced, not remembered

A proving request carries the user's private viewing key in its calldata, because the
pool needs it to compile actions inside the proof. So no request content reaches a log, a
metric, an error, or a job record.

```ts
import { redact, redactString, safeStringify } from "@limenlabs/proving-core";
```

The package's own tests assert that a viewing key cannot survive serialisation when
nested inside calldata, when embedded in an error, or past a depth bound. That is the
property worth testing, rather than testing that the redactor was called.

Apache-2.0 · [Security notes](https://github.com/winsznx/limen/blob/main/SECURITY.md) ·
[Repository](https://github.com/winsznx/limen)
