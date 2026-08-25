# Setup

Two tiers. Everything deterministic runs from a fresh clone with no credentials at all.
The live tier needs an RPC key, a funded account, and a machine to prove on.

---

## Tier 1 — no credentials

```sh
git clone https://github.com/winsznx/limen && cd limen
./scripts/bootstrap.sh
```

That checks the toolchain, installs dependencies, builds the pinned STRK20 Privacy SDK
from source (it is not on the public npm registry), builds the workspace, and runs both
test suites.

Then any of these, all of which regenerate committed evidence:

```sh
# The pinned upstream revision compiles to the class deployed at the mainnet pool.
node --experimental-strip-types tools/verify-pool-source.ts

# Live pool parameters: fee, version, class hash, proof validity window.
node --experimental-strip-types tools/probe-mainnet.ts

# The 100-case adversarial campaign.
node --experimental-strip-types scripts/generate-campaign.ts
node --experimental-strip-types scripts/run-campaign.ts
```

`verify-pool-source.ts` needs `scarb` to compile the pinned pool package. The others need
only a public Starknet RPC, and one is built in.

### Toolchain

| | Version | Notes |
| --- | --- | --- |
| Node | >= 24 | the Privacy SDK needs modern WebCrypto |
| pnpm | 11 | `corepack enable` |
| Scarb | 2.17.0 | pinned in `contracts/.tool-versions` |
| Starknet Foundry | 0.59.0 | same |

If `starkup` fails (its asdf path has been unreliable), install the release archives
directly:

```sh
ARCH=$([ "$(uname -m)" = "arm64" ] && echo aarch64 || echo x86_64)
OS=$([ "$(uname -s)" = "Darwin" ] && echo apple-darwin || echo unknown-linux-gnu)

curl -fsSL "https://github.com/software-mansion/scarb/releases/download/v2.17.0/scarb-v2.17.0-${ARCH}-${OS}.tar.gz" | tar xz -C ~/.local
curl -fsSL "https://github.com/foundry-rs/starknet-foundry/releases/download/v0.59.0/starknet-foundry-v0.59.0-${ARCH}-${OS}.tar.gz" | tar xz -C ~/.local
export PATH="$HOME/.local/scarb-v2.17.0-${ARCH}-${OS}/bin:$HOME/.local/starknet-foundry-v0.59.0-${ARCH}-${OS}/bin:$PATH"
```

---

## Tier 2 — live

Three external inputs. Limen generates everything else itself.

### 1. A Starknet Mainnet RPC key

The prover re-executes transactions and needs an endpoint on **spec 0.10.x**. Older
endpoints fail mid-proof with `missing field state_diff_commitment`, which does not look
like an RPC problem when you hit it.

Checked while building:

| Endpoint | Spec | Works |
| --- | --- | --- |
| Alchemy `.../rpc/v0_10/<KEY>` | 0.10.3-rc.0 | yes |
| `rpc.starknet.lava.build` | 0.10.2 | no |
| Alchemy `.../rpc/v0_9/<KEY>` | 0.9.0 | no |
| `starknet-mainnet.public.blastapi.io` | — | retired |

Treat the URL as a credential: it can carry a key in its path. It is never committed,
never baked into an image, and never logged.

### 2. A funded deployment account

Limen generates the account itself and never prints the private key:

```sh
node --experimental-strip-types tools/new-account.ts
```

It writes the key to `.env.local` (gitignored, `chmod 600`), prints only the address, and
refuses to overwrite an existing key so a funded account cannot be orphaned.

Fund it with **STRK** — Starknet v3 fees are paid in STRK, so no ETH is needed. Roughly
80 STRK covers:

| | ~STRK |
| --- | --- |
| Account deploy | 1 |
| Declare + deploy `LimenAnonymizer` and `CapitalGate` | 7 |
| Pool fee, register and shield | 6 |
| Pool fee, two clearances | 12 |
| Shielded demo capital | 10 |
| Challenge creation and approvals, gas only | 2 |
| Retry headroom | 40 |

The pool fee is read live from `get_fee_amount` rather than assumed; it was 6 STRK when
this was written, and the upstream docs said 4. Reverted transactions cost gas but not
pool fees.

### 3. A machine to prove on

A Docker-capable **x86_64** Linux host with at least **24 GB of RAM**. Both requirements
are real and both were measured:

- the published `linux/arm64` prover image aborts with `SIGILL` on generic aarch64,
- at 12 GiB the prover is killed 21–29 s into every proof.

[infra/prover/README.md](infra/prover/README.md) is the runbook.
`infra/prover/setup.sh` refuses to start below either threshold rather than letting you
discover it as a proof dying partway through.

```sh
cd infra/prover
cp .env.example .env && $EDITOR .env
./setup.sh
```

---

## Deploying

### Contracts

```sh
export $(grep -E '^(DEPLOYER_|STARKNET_)' .env.local | xargs)
node --experimental-strip-types scripts/deploy.ts
```

Declares and deploys both contracts, verifies the anonymizer is not on the pool's
open-note denylist, and writes the addresses into `strk20.json` and the web app's
environment. It refuses to run against an account it cannot read a balance for.

### The web app

```sh
cd apps/web
pnpm exec wrangler secret put STARKNET_RPC_URL
pnpm exec wrangler secret put LIMEN_GATEWAY_URL
pnpm exec wrangler secret put LIMEN_GATEWAY_TOKEN
pnpm deploy
```

No secret is a `NEXT_PUBLIC_` variable. The RPC URL and the gateway token are credentials
and are read server-side only; the deployment addresses are rendered as ordinary content
so they are not frozen at build time.

---

## Environment

`.env.local` at the repository root, gitignored, `chmod 600`:

| | |
| --- | --- |
| `DEPLOYER_ADDRESS` | generated by `tools/new-account.ts` |
| `DEPLOYER_PRIVATE_KEY` | generated, never printed |
| `STARKNET_MAINNET_RPC_URL` | spec 0.10.x endpoint |
| `LIMEN_GATEWAY_TOKEN` | bearer token for the prover gateway |
| `LIMEN_GATEWAY_URL` | tunnel hostname of the prover host |

`infra/prover/.env` on the prover host, from `.env.example`:
`PROVER_RPC_URL`, `GATEWAY_TOKEN`, `CLOUDFLARE_TUNNEL_TOKEN`.

Nothing in either file may be committed. Signing keys, viewing keys, decrypted notes and
proving witnesses never go into D1, analytics, logs, or source control —
[SECURITY.md](SECURITY.md) states the rule and
`packages/proving-core/src/redact.test.ts` enforces part of it.
