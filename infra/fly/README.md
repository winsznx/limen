# Limen on Fly.io

Two apps. The gateway is small and stays reachable; the prover is expensive and exists
only while it is actually proving.

```
internet ──► limen-prover-gateway.fly.dev     shared-cpu-1x / 512 MB
                    │                          auto-stops when idle
                    │  limen-prover.flycast:3000
                    ▼
             limen-prover                      performance-4x / 32 GB
                                               no public address at all
                                               created and destroyed per session
```

The prover has no public IP and no route from the internet. It is reachable only across
the organisation's private network, from the gateway. Fly terminates HTTPS on the
gateway, so there is no tunnel to run and no certificate to manage.

## Why this shape

Proving is bursty. A proof takes minutes of a whole machine, and then nothing happens
for hours. Paying for 32 GB continuously across a two-week judging window buys nothing:
the mainnet transaction hashes are permanent and independently verifiable long after the
machine is gone, and no judge can trigger proving from a browser anyway (the Wallet API
cannot reach the pool's compute-and-invoke path, CONTRIBUTIONS.md C-2).

So the prover is created for a session, does the work, and is destroyed.

## Cost

| | Shape | Approx. |
| --- | --- | --- |
| Prover, while running | performance-4x + 24 GB extra RAM | ~$0.31/hr |
| Gateway, idle-stopped | shared-cpu-1x / 512 MB | pennies over two weeks |
| **A 12-hour session** | | **~$3.70** |

RAM is the dominant cost: Fly charges about **$5 per GB per 30 days** on top of the CPU
preset, and 32 GB is 24 GB above what `performance-4x` ships with.

Two things worth knowing before relying on a budget:

- **A small-invoice waiver is not a spending cap.** If a threshold exists on your
  account and you go past it, you are billed the full amount, not the excess. Check your
  own billing dashboard rather than assuming.
- **Stopped is not free.** A stopped machine still bills for its root filesystem. The
  session script destroys rather than stops.

`./infra/fly/session.sh cost` gives a running estimate from the machine's uptime.

## Why performance-4x

Fly caps memory at **8 GB per performance CPU**, so 32 GB needs at least four. It is
also the smallest shape above the measured failure point: at 12 GiB the prover is killed
21–29 seconds into every proof, unchanged with caches cut, because the memory belongs to
the Stwo prover core. Upstream recommends 48 vCPU / 96 GB, so this is a deliberately
measured trade rather than a comfortable margin. DECISIONS.md D-011.

If 32 GB turns out not to be enough, `performance-8x` reaches 64 GB at roughly double the
hourly rate. The benchmark records peak usage so the requirement stops being a guess.

## First-time setup

```sh
fly auth login

fly apps create limen-prover
fly apps create limen-prover-gateway

# The prover's only inbound path: a private address, reachable inside the org.
fly ips allocate-v6 --private -a limen-prover

# A Starknet mainnet endpoint on spec 0.10.x. Older endpoints fail mid-proof with
# 'missing field state_diff_commitment', which does not look like an RPC problem.
fly secrets set -a limen-prover \
  RPC_URL='https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/<KEY>'

# Bearer token on every proving request. Without it the gateway is an open proving
# oracle and anyone can spend the machine's capacity.
fly secrets set -a limen-prover-gateway \
  GATEWAY_TOKEN="$(openssl rand -base64 32 | tr -d '\n' | tr '+/' '-_')"

# The gateway builds from this repository, so run it from the repository root.
fly deploy --config infra/fly/gateway.fly.toml --dockerfile infra/prover/Dockerfile.gateway
```

Worth doing once, early: `fly deploy --config infra/fly/prover.fly.toml --ha=false` to confirm a
`performance-4x` is allowed on the account. New organisations are sometimes limited to
smaller shapes, and that is much better to discover now than on the night.

## A session

```sh
./infra/fly/session.sh up       # deploy the prover, wait until it actually serves
./infra/fly/session.sh status   # what is running
./infra/fly/session.sh cost     # running estimate
./infra/fly/session.sh down     # destroy it, stop the billing
```

`up` refuses to start if `RPC_URL` is unset, and waits for the gateway to report
`healthy: true`, meaning the prover answered JSON-RPC, not that a machine exists.

Between `up` and `down`:

```sh
node --experimental-strip-types scripts/deploy.ts            # contracts, once
node --experimental-strip-types scripts/prover-benchmark.ts --samples 20
node --experimental-strip-types scripts/verify-mainnet.ts
```

## When the prover is gone

The gateway keeps answering and reports itself unhealthy, with a reason. That is
deliberate: the console renders it as unreachable rather than inventing a green light,
and every mainnet transaction stays verifiable from chain with nothing running at all.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Prover log stops mid-proof, machine restarts | Out of memory. Move to `performance-8x` / 64 GB |
| `missing field state_diff_commitment` | The RPC endpoint is not on spec 0.10.x |
| Gateway reports unhealthy with a connection error | The prover is destroyed, or the private IP was never allocated |
| `could not find app` | `fly apps create` has not been run |
| Deploy times out pulling the image | 1.12 GB image; `wait_timeout` is already 15m, retry |
| Two machines appear after a deploy | Fly's HA default. Always deploy with `--ha=false`; at 32 GB the second machine doubles the bill |
| A public IP was allocated | Say **no** to the dedicated-IP prompt. The prover must have no public route, and a dedicated v4 also costs $2/mo. Undo with `fly ips release <ip>` |
