# Upstream contributions

Findings from building Limen that are defects or gaps in STRK20 itself rather than in
Limen. Each one was hit while building, reproduced deliberately, and reduced to the
smallest case that still shows the behaviour.

Nothing here is filed for the sake of filing. Two findings cost real debugging time and
would cost the next team the same, and both have a reproduction anyone can run.

---

## C-1 — The published prover images are built for one microarchitecture, and nothing says so

**Component:** `ghcr.io/starkware-libs/starknet-privacy/transaction-prover`
**Tag:** `PRIVACY-0.14.3-RC.2`
**Status:** reproduced on three independent hosts, root cause confirmed in the Dockerfile

### What happens

The image publishes `linux/amd64` and `linux/arm64` manifests. On most hosts the prover
binary dies with `SIGILL` — illegal instruction — before doing any work at all. Not
during proving: on `--version`.

| Host | Arch | Result |
| --- | --- | --- |
| Apple Silicon (M-series) | arm64 | `SIGILL`, exit 132 |
| Fly.io `iad`, performance CPU | amd64 | `SIGILL`, exit 132 |
| Fly.io `ord`, performance CPU | amd64 | `SIGILL`, exit 132 |
| Cloudflare Containers | amd64 | runs normally |

Same image, same digest. One amd64 host runs it and two do not, so this is a CPU
capability difference rather than a broken image.

### Reproduction

```sh
docker run --rm --platform linux/arm64 \
  --entrypoint sh \
  ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2 \
  -c '/app/target/release/starknet_transaction_prover --version; echo "exit=$?"'
```

```
Illegal instruction
exit=132
```

The container itself is healthy — `sh` runs, `uname -m` prints the expected
architecture, the 172 MB binary is present and executable. Only the binary faults.

On the arm64 host, `/proc/cpuinfo` reports no `sve`, `sve2`, `bf16` or `i8mm`.

### Root cause

`crates/starknet_transaction_prover/Dockerfile` in `starkware-libs/sequencer`:

```dockerfile
ARG TARGET_CPU=""
```

The default is a portable build. `TARGET_CPU` is then injected as
`-C target-cpu=${TARGET_CPU}` through profile environment variables. The prover's README
documents this as a performance option and gives `znver5` as the example, "optimized for
AMD EPYC Turin (GKE c4d nodes)".

So the published images are built **with** a CPU target — matching the hardware the
project runs on — and that constraint appears nowhere a consumer would look: not in the
tag, not in the README's compatibility matrix, not in the image labels, and not in the
error the binary produces.

The image records its own provenance, which makes this checkable rather than inferred:

```sh
docker image inspect ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2 \
  --format '{{json .Config.Labels}}'
```

```json
"org.opencontainers.image.revision": "e6b6fd2e9932909107833579e5b6efd6c75fa0af",
"org.opencontainers.image.version": "PRIVACY-0.14.3-RC.2"
```

Building that exact commit with `TARGET_CPU` left at its default produces a binary that
runs on hosts where the published one dies. Same source, same crate, same
`--features stwo_proving` — the only difference is the microarchitecture pin.

Note also what the labels do *not* record: there is no `TARGET_CPU`, so nothing in the
image says which CPU it was built for.

### Why it matters

A `linux/amd64` tag is a promise about a platform, not about one vendor's newest server
CPU. The failure mode is unusually expensive to diagnose:

- it happens at process start, so there are no logs beyond `Illegal instruction`,
- the message names neither the CPU nor the instruction set,
- exit code 132 through a container runtime often surfaces as something vaguer, such as
  a health check that never passes or a machine that restarts until it hits a cap,
- and it looks identical to an out-of-memory kill, which is the failure teams running a
  prover are primed to expect.

Anyone developing on Apple Silicon hits it immediately. Anyone deploying to a host
without Zen 5-class CPUs hits it in production and has little to go on.

### Suggested fix

Any one of these would have saved the diagnosis:

1. Publish the default portable build under the main tag, and CPU-optimised builds under
   an explicit tag such as `PRIVACY-0.14.3-RC.2-znver5`. Portability is the reasonable
   default for a published artefact; the optimisation is the special case.
2. Record the target in an OCI label, so `docker inspect` answers the question.
3. Note the requirement in the compatibility matrix next to the image reference, where
   someone choosing a host will see it.
4. Add a startup check that reports the missing CPU feature by name instead of faulting.

### How Limen works around it

Limen rebuilds the prover from the pinned source with `TARGET_CPU` left at its default
and runs that. The rebuild is not a fork: same commit, same crate, same feature flags,
only without the microarchitecture pin. `infra/fly/README.md` documents it, and
`infra/prover/setup.sh` refuses to start on a host where the published image is known
not to run.

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

## C-3 — The branch the prover README links to does not build

**Component:** `starkware-libs/sequencer`, branch `avi/privacy/configmap-docs`
**Status:** reproduced

### What happens

The prover's README — the one linked from the STRK20 compatibility matrix — lives on
`avi/privacy/configmap-docs`, and that branch's Dockerfile fails in its base stage before
compiling anything:

```
error: failed to compile `cargo-chef v0.1.78`
Caused by:
  rustc 1.90.0-nightly is not supported by the following package:
    cargo-platform@0.3.3 requires rustc 1.91
  Try re-running `cargo install` with `--locked`
```

The branch pins `nightly-2025-07-14` (rustc 1.90.0-nightly) in
`crates/starknet_transaction_prover/rust-toolchain.toml`, then runs
`cargo install cargo-chef` **unpinned**. Once cargo-chef's transitive dependencies raised
their minimum supported rustc past that nightly, the build stopped working for everyone.

### Reproduction

```sh
git clone --depth 1 --branch avi/privacy/configmap-docs \
  https://github.com/starkware-libs/sequencer.git && cd sequencer
docker build -f crates/starknet_transaction_prover/Dockerfile .
```

### Suggested fix

`cargo install --locked cargo-chef`, exactly as the error advises. The release commit
`e6b6fd2` already does this, so the fix is simply not present on the documentation
branch. Since that branch is what the compatibility matrix links to, it is the copy most
readers will try first.

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
