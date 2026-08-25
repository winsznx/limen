# Upstream contributions

Findings from building Limen that are defects or gaps in STRK20 itself rather than in
Limen. Each one was hit while building, reproduced deliberately, and reduced to the
smallest case that still shows the behaviour.

Nothing here is filed for the sake of filing. Two findings cost real debugging time and
would cost the next team the same, and both have a reproduction anyone can run.

---

## C-1 — The published `linux/arm64` transaction-prover image aborts with SIGILL

**Component:** `ghcr.io/starkware-libs/starknet-privacy/transaction-prover`
**Tag:** `PRIVACY-0.14.3-RC.2`
**arm64 manifest:** `sha256:9882d27692b420a9edae9b50bf8075103044230de0f83ee6bed3db19cace105f`
**Status:** reproduced, minimal case below, report drafted

### What happens

The image publishes a `linux/arm64` variant. On a generic aarch64 host — Apple Silicon,
and by inspection any CPU without SVE — the prover binary dies with `SIGILL` before it
does anything at all. Not during proving: on `--version`.

### Reproduction

```sh
docker run --rm --platform linux/arm64 \
  --entrypoint sh \
  ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2 \
  -c '/app/target/release/starknet_transaction_prover --version; echo "exit=$?"'
```

Observed:

```
Illegal instruction
exit=132
```

The container itself is fine — `sh` runs, `uname -m` prints `aarch64`, the binary is
present and executable at 172 MB. Only the binary faults.

Host CPU features, from inside the same container:

```
fp asimd evtstrm aes pmull sha1 sha2 crc32 atomics fphp asimdhp cpuid asimdrdm jscvt
fcma lrcpc dcpop sha3 asimddp sha512 asimdfhm dit uscat ilrcpc flagm sb paca pacg
dcpodp flagm2 frint
```

No `sve`, `sve2`, `bf16` or `i8mm`. The prover's own README documents `TARGET_CPU` as a
build argument for CPU-specific builds and gives `znver5` as the x86 example, so the
most likely cause is that the arm64 variant was built with a `-C target-cpu` implying
SVE — correct for a Neoverse-class server, wrong for the generic `linux/arm64` platform
tag it is published under.

### Why it matters

`linux/arm64` is a promise about a platform, not about one CPU. A tag that only runs on
some aarch64 machines fails at `--version` with an error naming neither architecture nor
instruction set, which is a slow thing to diagnose. Anyone developing on Apple Silicon
hits it immediately, and the failure looks like a broken image rather than a targeting
mismatch.

### Suggested fix

Build the published `linux/arm64` variant for a baseline `armv8-a`, and if a
CPU-specific build is wanted, publish it under a distinct tag. Failing that, document
the requirement in the README next to the existing `TARGET_CPU` note, or drop the arm64
variant so the platform mismatch surfaces at pull time rather than at runtime.

### How Limen works around it

`infra/prover/docker-compose.yml` pins the `linux/amd64` manifest by digest, and
`infra/prover/setup.sh` refuses to start on a non-x86_64 host with an error that names
this issue.

---

## C-2 — The Wallet API cannot reach the pool's `ComputeAndInvoke` path

**Component:** Starknet Wallet API / `@starknet-io/types-js`
**Version checked:** `0.10.3`
**Status:** reproduced, report drafted

### What happens

The deployed mainnet pool supports two invoke-phase client actions:

| Client action | Target entry point | What the target receives |
| --- | --- | --- |
| `InvokeExternal` | `privacy_invoke` | only what the caller put in calldata |
| `ComputeAndInvoke` | `privacy_compute` then `privacy_invoke_with_computation` | a pool-derived `identity_key`, bound into the proof |

The Wallet API exposes only the first. In `@starknet-io/types-js@0.10.3`:

```ts
export type STRK20_ACTION =
  | STRK20_DEPOSIT_ACTION
  | STRK20_WITHDRAW_ACTION
  | STRK20_TRANSFER_ACTION
  | STRK20_INVOKE_ACTION;   // -> privacy_invoke only
```

There is no `compute_and_invoke` variant, and no way to express one.

### Why it matters

`identity_key` is

```
poseidon(IDENTITY_KEY_TAG, user_addr, user_private_key, contract_address)
```

derived by the pool inside the proven execution. It is the only user identity in STRK20
that is unforgeable without the viewing key, stable per (user, contract), unlinkable
across contracts, and free of the user's address. Upstream's own doc comment calls it
"a pseudonymous proof of ownership the target can derive sub-accounts from without
learning who the user is".

The Wallet API is the route the documentation recommends for most private dapps, and it
is the only route that keeps viewing keys inside the wallet. So today the primitive best
suited to user-facing dapps is available only to integrations that hold the user's
viewing key themselves — which is the arrangement the Wallet API exists to avoid.

Concretely for Limen: a challenge cannot be cleared from a browser wallet at all,
because the subject binding and the proof-bound balance snapshot both depend on
`ComputeAndInvoke`. Falling back to `privacy_invoke` would mean accepting a
caller-supplied subject, which is not a subject at all.

### Reproduction

```sh
npm i @starknet-io/types-js@0.10.3
grep -n 'STRK20_ACTION =' node_modules/@starknet-io/types-js/dist/types/wallet-api/components.d.ts
```

Compare against `ClientAction` in the deployed pool class
`0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`, which lists
`ComputeAndInvoke`, and against `privacy::hashes::compute_identity_key` in
`starkware-libs/starknet-privacy@74841ca`.

### Suggested fix

Add a fifth action mirroring the pool's own shape:

```ts
export type STRK20_COMPUTE_AND_INVOKE_ACTION = {
  type: 'compute_and_invoke';
  contract: ADDRESS;
  computeAdditionalData?: STRK20_CALLDATA_ITEM[];
  invokeAdditionalData?: STRK20_CALLDATA_ITEM[];
};
```

The wallet already resolves `${openNoteIds[N]}` and `${poolAddress}` placeholders in
invoke calldata, so the substitution machinery is in place; the pool supplies the
identity key itself, so no key material has to leave the wallet. The Privacy SDK has
carried `builder.computeAndInvoke(...)` since `0.14.3-rc.2`, so the two routes are
simply out of step.

### How Limen works around it

Clearances run through the key-holding SDK route. The limitation, and the fact that it
is upstream rather than a Limen design choice, is stated in README limitations and in
DECISIONS.md D-013.

---

## Checked and deliberately not filed

- **Open-note deposits and public transfers.** An anonymizer cannot tell capital the
  pool withdrew to it from capital someone transferred to it publicly, because an ERC-20
  balance carries no provenance. It affects any helper measuring across the pool's
  withdraw leg. It is a design property with a real trade-off behind it rather than a
  defect, the shipped helpers avoid it by bracketing an external call, and the pool
  already publishes the withdrawal that makes it externally checkable. Limen documents
  it as its own disclosed boundary (DECISIONS.md D-007) instead of filing it as a bug.
- **The prover's zero-fee requirement.** Rejecting non-zero fee fields makes replaying a
  signed mainnet transaction impossible without `SKIP_FEE_FIELD_VALIDATION`, since
  rewriting those fields changes the transaction hash. The flag exists and the error
  message is specific and helpful. Working as intended.
- **RPC spec requirements.** The prover needs spec 0.10.x and fails on older endpoints
  with `missing field state_diff_commitment`. The compatibility matrix does pin a node
  version. A clearer error would help, but this is thin for an issue on its own; it is
  captured in Limen's own setup preflight instead.
