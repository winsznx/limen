# LIMEN — Product Requirements Document

**Version:** 1.0  
**Competition:** STRK20 Private Sprint  
**Network target:** Starknet Mainnet (`SN_MAIN`)  
**Product line:** Prove you can meet the threshold without revealing your total balance.  
**Primary build mode:** autonomous agent execution  
**Design specification:** `DESIGN.md` is authoritative for visual design and interaction styling.  
**Product specification:** this file is authoritative for scope, behavior, security, evidence, and acceptance gates.

---

## 0. Agent Operating Contract

This repository is to be built autonomously.

The implementation agent must:

1. Read this document end to end before changing architecture.
2. Install and consult the official STRK20 skills and their bundled upstream references rather than relying on memory:
   ```bash
   npx skills add welttowelt/strk20-skills
   ```
3. Treat official STRK20/Starknet source, the installed skills, and current upstream repositories as authoritative for protocol interfaces.
4. Never invent a STRK20 calldata layout, proof format, pool interface, wallet API method, anonymizer interface, or open-note behavior. Inspect the pinned upstream implementation first.
5. Work until every mandatory acceptance gate in this PRD is satisfied or an external dependency genuinely requires the owner.
6. Ask the owner only for:
   - external secrets or credentials,
   - account permission,
   - funds,
   - a domain or hosted service the agent cannot create,
   - an irreversible mainnet action that cannot safely be performed with the dedicated project wallet,
   - a decision explicitly marked `OWNER DECISION`.
7. Generate dedicated project deployment wallets/keys when needed. Never print private keys in chat. Return only public addresses for funding.
8. Keep every secret in environment variables. Never commit secrets, mnemonic phrases, private keys, viewing keys, RPC keys, API tokens, or auth cookies.
9. Prefer deterministic local/fork tests for correctness and use mainnet only for the smallest amount of live evidence required.
10. Do not claim functionality that has not been executed.
11. Do not replace a blocked critical integration with a mock and present it as shipped.
12. Keep the project public and reviewer-legible throughout the sprint.
13. Deploy the web application to Cloudflare Workers through Wrangler.
14. Do not attempt to run the heavy STRK20 transaction prover inside Cloudflare Workers. Heavy proving belongs on a dedicated Docker-capable Linux host.
15. Keep a running `BUILD_LOG.md`, `DECISIONS.md`, and claim/evidence ledger while building.
16. After every major architecture change, update all public docs before continuing.
17. Before final submission, run a clean-room reproduction from a fresh clone or container.

If a protocol assumption in this PRD conflicts with current upstream code, upstream wins. Record the discrepancy in `DECISIONS.md` and adapt while preserving the product thesis.

---

# 1. Product Summary

## 1.1 Name

**Limen**

Limen is the entire product. Do not expose separate brands for the proving subsystem, anonymizer, gateway, or developer infrastructure.

Allowed component names:

- Limen Protocol
- Limen SDK
- Limen Prover
- Limen Gateway
- Limen Anonymizer
- Limen Challenges
- Limen Explorer
- Limen Developer Console

Do not introduce a separate product name such as Proofrail or Clearance.

## 1.2 One sentence

Limen lets an application require a capital threshold from a STRK20 user, privately prove that the user can mobilize that amount, execute the authorized action, and return the capital to the shielded pool without exposing the user's total balance or note history.

## 1.3 Judge-compressed narrative

**10 seconds — problem**

Onchain apps often need to know whether a user has enough capital, which normally means exposing a wallet and its balances.

**20 seconds — product**

Limen lets a STRK20 user satisfy a capital threshold and unlock an action without publishing their total shielded balance, underlying notes, or private transfer history.

**60 seconds — mechanism**

The application issues a challenge for token `X` and threshold `T`. The user's client constructs a real STRK20 private transaction that mobilizes exactly `T` from valid shielded notes through the Limen Anonymizer. The anonymizer validates the challenge, executes the bound action or issues a one-time clearance, and atomically returns the capital into a shielded note. If the user cannot privately supply `T`, no valid clearance can be produced. Limen also includes the proving infrastructure required to generate and reliably submit the STRK20 proof itself.

## 1.4 Core claim

> A target application can condition an action on a user successfully mobilizing at least threshold `T` of token `X` from valid STRK20 private state, without requiring disclosure of the user's total balance.

This is a falsifiable claim.

It is false if any of these are possible:

- a user below `T` receives clearance,
- an expired challenge succeeds,
- a challenge can be replayed,
- a clearance can be used against a different target,
- a different token satisfies the challenge,
- a direct call bypasses the STRK20 path,
- funds can be stranded or stolen by the Limen contract under normal successful execution,
- the product secretly depends on a fully disclosed balance.

---

# 2. Competition Requirements

The sprint is scored on:

- **30% STRK20 integration depth**
- **30% working mainnet product**
- **25% innovation**
- **15% documentation and open-source quality**

The finished project must optimize explicitly for all four.

Mandatory competition delivery:

- public GitHub repository,
- registration in the sprint registry,
- `strk20.json` at repository root,
- Starknet Mainnet execution,
- at least three real mainnet transaction hashes touching the STRK20 pool,
- deployed contract addresses,
- public demo anyone can open,
- three-minute demo video,
- clear README,
- open-source license.

Current STRK20 Mainnet pool reference:

```text
0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

Do not hardcode a pool fee. Read the live fee from the pool using the current authoritative interface. Store the observed value in evidence output.

`strk20.json` starts as:

```json
{
  "transactions": [],
  "contracts": [],
  "demo_video": "",
  "demo_url": ""
}
```

Populate fields only with real delivered artifacts.

---

# 3. Problem

Privacy creates a practical qualification problem.

A public application can easily ask:

> Does this wallet hold at least 5,000 USDC?

A shielded user should not need to reveal:

- their total holdings,
- their other notes,
- their payment history,
- their entire viewing key,
- unrelated positions,

just to satisfy that one condition.

The standard workarounds are bad:

1. unshield and reveal the position,
2. disclose broad wallet information,
3. rely on a trusted off-chain attestation,
4. require a regulator/auditor disclosure path intended for another purpose.

Limen turns a private balance into a usable authorization condition.

The first product is not general proof-of-solvency.

Do not market it as proof-of-solvency.

A point-in-time proof of funds can be satisfied with borrowed funds and says nothing about liabilities. The correct initial claim is **private proof of available capital for a bounded action**.

---

# 4. Product Thesis

Private state becomes much more useful when it can satisfy public application constraints without becoming public.

Limen's initial primitive is:

```text
private capital
      +
application challenge
      +
real STRK20 execution
      =
bounded authorization
```

The long-term protocol can extend the same model to:

- allocation eligibility,
- OTC counterparty qualification,
- private credit prequalification,
- minimum collateral requirements,
- treasury mandate limits,
- range-bound eligibility,
- institutional policy gates.

The hackathon build must prove only the capital-threshold primitive completely.

---

# 5. Dominant Mechanism

## 5.1 Challenge

A target application creates a challenge:

```text
Challenge {
  id
  token
  threshold
  target
  action_hash
  subject
  nonce
  issued_at
  expires_at
  consumed
}
```

Exact Starknet field encodings must use safe felt-compatible representations.

The challenge must be domain-separated and bind at least:

- chain ID,
- Limen contract address,
- target contract,
- requested action,
- token,
- threshold,
- subject or session identity,
- nonce,
- expiration.

## 5.2 Private execution

The user's client spends valid STRK20 private state sufficient to mobilize exactly threshold `T`.

The Limen Anonymizer must only accept the call from the authoritative STRK20 pool.

The anonymizer:

1. validates the challenge,
2. verifies target/token/threshold/subject/expiry/nonce,
3. ensures the supplied value corresponds to the challenge,
4. marks the challenge consumed before any reentrant external action where relevant,
5. executes the bound action or records a one-time clearance,
6. returns all threshold capital to a shielded output using the current supported STRK20/open-note path,
7. emits only the minimum public event data needed for verification and demo evidence.

No admin or relayer may fabricate a successful capital condition without the pool-mediated capital flow.

## 5.3 Two authorization modes

Implement the abstraction for both modes, but one may be canonical in the UI.

### Mode A — atomic action

Preferred when feasible.

```text
private spend T
→ Limen Anonymizer
→ target action executes
→ T returns shielded
```

No reusable credential survives.

### Mode B — one-time clearance

Use if target integration is cleaner through a credential.

```text
private spend T
→ Limen Anonymizer
→ one-time clearance issued
→ T returns shielded
→ target consumes clearance
```

A clearance must be:

- subject-bound,
- target-bound,
- action-bound,
- token-bound,
- threshold-bound,
- nonce-bound,
- expiry-bound,
- single-use.

Canonical demo preference: **Mode A** if current STRK20 execution semantics allow it cleanly.

---

# 6. Privacy Boundary

Never use vague claims such as "fully anonymous", "invisible", or "reveals nothing".

## 6.1 Expected public information

Depending on the final upstream-compatible implementation, assume the following may be public and design copy accordingly:

- token used for the challenge,
- threshold requested,
- target application,
- action identifier,
- challenge nonce/hash,
- challenge expiration,
- that a clearance/action succeeded,
- transaction timing,
- public pool and anonymizer interactions,
- public deposit and withdrawal edges outside the private pool,
- any amount exposed by the chosen open-note/anonymizer construction.

## 6.2 Information Limen aims not to disclose

- total shielded balance,
- balance above the requested threshold,
- unrelated shielded notes,
- unrelated private transfer history,
- viewing key,
- private signing key,
- all unrelated application activity.

## 6.3 Side-channel statement

The product must explicitly disclose:

- timing correlation can reduce privacy,
- distinctive amounts can reduce privacy,
- deposit and withdrawal edges are public by protocol design,
- a small anonymity set can weaken unlinkability,
- the threshold itself is intentionally public to the verifier,
- Limen proves a bounded capital condition, not identity anonymity or solvency.

A privacy claim is only accepted when the code path and docs agree on the public/private boundary.

---

# 7. Limen Proving Infrastructure

The proving subsystem is part of Limen, not a separate product.

Its purpose is twofold:

1. make Limen independent of an unpublished or unreliable third-party proving endpoint,
2. leave behind reusable open infrastructure for other STRK20 applications.

## 7.1 Required proving path

Build a provider abstraction:

```ts
interface LimenProvingProvider {
  health(): Promise<ProviderHealth>
  prove(request: ProvingRequest): Promise<ProvingResult>
}
```

Required implementations:

- local/self-hosted Limen prover provider,
- wallet-managed/provider adapter if supported cleanly by the official Wallet API.

The **canonical evidence path must include at least one successful Mainnet Limen transaction whose proof is generated through the Limen self-hosted proving path**.

Otherwise the proving subsystem is not load-bearing enough to claim as core infrastructure.

## 7.2 Prover gateway responsibilities

The gateway must provide:

- strict request validation,
- pinned protocol/version compatibility,
- finalized/canonical block selection according to upstream requirements,
- queue/admission control,
- bounded concurrency,
- health checks,
- request IDs,
- idempotency,
- retry classification,
- timeout handling,
- typed errors,
- worker restart/recovery,
- zero secret logging,
- proof validation before returning success,
- metrics,
- reproducible Docker deployment.

Do not invent retry behavior around cryptographic failures. Only retry errors proven transient by upstream semantics.

## 7.3 OHTTP

If supported by the current pinned STRK20 Privacy SDK and feasible without weakening correctness, implement OHTTP transport between client/edge relay and proving gateway.

If implemented:

- the relay and gateway must be treated as separate trust roles,
- the relay must not log decrypted proving payloads,
- the gateway should not receive the user's direct client connection metadata,
- keys/config must come from upstream-supported OHTTP primitives,
- document precisely what metadata each component can observe.

OHTTP is **not allowed to block the dominant mainnet mechanism**. If upstream incompatibility appears, record it and ship the fully working direct provider first.

## 7.4 Prover host

The heavy prover runs in Docker on a dedicated Linux host.

Requirements:

- explicit image digest or pinned source revision,
- portable CPU target unless a host-specific optimization is deliberately chosen,
- memory limit,
- loopback/private binding where possible,
- authenticated or network-restricted gateway,
- no public unauthenticated raw prover port,
- liveness and readiness probes,
- clean startup/shutdown,
- documented resource measurements.

Do not run the heavy prover in Cloudflare Workers.

---

# 8. System Architecture

```text
Browser / Wallet
    │
    ├── connect
    ├── challenge
    ├── prepare private STRK20 action
    └── sign
    │
    ▼
Limen Web + Edge API
Cloudflare Workers
    │
    ├── challenge API
    ├── public verification
    ├── non-sensitive status
    ├── optional OHTTP relay
    └── developer console
    │
    ▼
Limen Prover Gateway
Docker-capable Linux host
    │
    ├── admission
    ├── idempotency
    ├── queue
    ├── worker health
    ├── retries
    └── proof generation
    │
    ▼
STRK20 Mainnet
    │
    ▼
Limen Anonymizer
    │
    ├── validate challenge
    ├── enforce one-time semantics
    ├── execute target action
    └── return capital privately
    │
    ├──────────────► DemoCapitalGate
    │
    └──────────────► shielded output
```

## 8.1 Suggested repository layout

The agent may adapt package boundaries if needed, but preserve responsibility separation.

```text
/
├── apps/
│   └── web/                       # Next.js UI deployed to Cloudflare
├── packages/
│   ├── limen-sdk/                 # public developer API
│   ├── limen-client/              # challenge + transaction preparation
│   ├── proving-core/              # provider interfaces/types
│   ├── prover-gateway/            # gateway and reliability layer
│   ├── observability/             # typed metrics/logging/redaction
│   └── protocol-config/           # chain/pool/version config
├── contracts/
│   ├── limen-anonymizer/
│   ├── capital-gate/
│   └── shared/
├── infra/
│   └── prover/
│       ├── Dockerfile
│       ├── docker-compose.yml
│       ├── build.sh
│       ├── healthcheck.sh
│       └── README.md
├── scripts/
│   ├── bootstrap.*
│   ├── deploy.*
│   ├── mainnet-proof.*
│   ├── verify-mainnet.*
│   ├── run-campaign.*
│   └── clean-room.*
├── evidence/
│   ├── claims.json
│   ├── mainnet/
│   ├── campaigns/
│   └── benchmarks/
├── docs/
│   ├── PROTOCOL.md
│   ├── PROVER.md
│   ├── PRIVACY.md
│   ├── THREAT_MODEL.md
│   └── RUNBOOK.md
├── PRD.md
├── DESIGN.md
├── README.md
├── ARCHITECTURE.md
├── SECURITY.md
├── CONTRIBUTIONS.md
├── DECISIONS.md
├── BUILD_LOG.md
├── SETUP.md
├── LICENSE
└── strk20.json
```

---

# 9. Product Surfaces

Follow `DESIGN.md`. Do not create generic crypto UI, glassmorphism, glowing chains, fake terminals, meaningless metrics, or filler cards.

The product UI itself should be the visual language.

## 9.1 Landing

Primary goal: explain the product in under 20 seconds and let a judge enter the live flow.

Suggested hero:

**Headline:**  
`Prove enough. Keep the rest private.`

**Body:**  
`Limen lets Starknet apps require a capital threshold without asking users to reveal their total shielded balance.`

Primary CTA:

`Try a capital challenge`

Secondary CTA:

`View protocol`

Hero product visual should be a real Limen challenge/proof interface, not decorative art.

## 9.2 Challenge page

Example route:

```text
/challenge/new
```

Fields:

- token,
- threshold,
- target,
- action,
- expiry,
- subject/session.

The hackathon demo should expose a preconfigured example so a judge does not need to configure infrastructure.

## 9.3 User clearance page

Example:

```text
/challenge/:id
```

Show:

- requested token,
- requested threshold,
- target action,
- expiry,
- privacy disclosure,
- network,
- proving provider,
- CTA to execute.

Before signature, show a concise "what becomes public / what stays private" section.

## 9.4 Success state

Show:

- `CLEARED`,
- threshold,
- token,
- action executed,
- mainnet block,
- transaction hash,
- anonymizer contract,
- proving provider,
- proof latency,
- capital returned state when verifiable.

Never show invented exact balances.

## 9.5 Failure state

Failure states are first-class product surfaces:

- below threshold,
- expired challenge,
- consumed/replay,
- wrong target,
- wrong token,
- wallet disconnected,
- RPC unavailable,
- prover unavailable,
- proof rejected,
- transaction reverted,
- insufficient gas/fee,
- pool not ready/mature note state where applicable.

Each state must tell the user what failed and whether retry is safe.

## 9.6 Developer console

This is a technical evidence surface, not the landing page.

Show only real data:

- provider health,
- network,
- pinned protocol version,
- queue depth,
- active proofs,
- latest proof duration,
- latest result,
- worker status,
- recent non-sensitive proof jobs,
- mainnet evidence links.

No raw witnesses, calldata containing secrets, viewing keys, or private note plaintext.

## 9.7 Explorer / evidence page

A judge should be able to inspect:

- contract addresses,
- qualifying mainnet transactions,
- challenge hash,
- target action,
- public result,
- proof provider metadata,
- campaign results,
- links to reproducible verification commands.

---

# 10. Contract Requirements

## 10.1 Limen Anonymizer

Mandatory properties:

- only callable through the correct STRK20 pool path,
- pool address pinned/validated,
- challenge is domain-separated,
- challenge must exist,
- token matches,
- threshold matches,
- target/action matches,
- subject/session binding enforced,
- expiry enforced,
- nonce uniqueness enforced,
- replay rejected,
- challenge consumed atomically,
- funds cannot cross into another challenge,
- funds returned according to the validated STRK20 output path,
- no privileged admin can mint a valid clearance without satisfying the same conditions,
- no arbitrary external-call surface that lets a challenge bypass its bound target,
- external call failures revert cleanly,
- event data intentionally minimized.

## 10.2 Demo Capital Gate

A tiny reference application demonstrating consumption of Limen authorization.

It should have one familiar gated action, for example:

```text
register_allocation()
```

or

```text
enter_room()
```

Do not turn the demo target into another large product.

Its job is to prove Limen can authorize a real contract action.

## 10.3 Upgrade/admin policy

Prefer immutable contracts for the sprint unless upgradeability is genuinely needed.

If admin controls exist:

- enumerate them,
- document why,
- prevent them from fabricating capital evidence,
- include tests proving the trust boundary.

---

# 11. Client and SDK Requirements

## 11.1 Public SDK surface

Target an API roughly like:

```ts
const limen = createLimen({
  network: "mainnet",
  provingProvider,
});

const challenge = await limen.getChallenge(id);

const prepared = await limen.prepareClearance({
  challenge,
  wallet,
});

const result = await limen.execute(prepared);
```

Exact upstream wallet/provider types must follow current STRK20/Starknet APIs.

## 11.2 Requirements

- no private key in application logs,
- no viewing key in browser telemetry,
- no amount conversion through JS floating point,
- use integer/base-unit-safe arithmetic,
- explicit token decimals,
- validate chain ID,
- validate target contract,
- validate challenge freshness immediately before signature,
- transaction idempotency where the application can safely guarantee it,
- safe retry semantics,
- readable error codes.

---

# 12. Security Model

Create `SECURITY.md` and `docs/THREAT_MODEL.md`.

## 12.1 Assets

- user signing key,
- user viewing key,
- shielded notes/witness,
- proof request,
- challenge state,
- threshold capital,
- returned shielded value,
- mainnet deployment keys,
- prover capacity.

## 12.2 Adversaries

- malicious user,
- malicious verifier/target,
- malicious web client,
- malicious prover operator,
- compromised edge worker,
- replay attacker,
- front-runner,
- RPC inconsistency,
- dependency compromise,
- denial-of-service attacker.

## 12.3 Required security properties

1. Below-threshold users cannot obtain a valid authorization.
2. A valid authorization cannot be replayed.
3. A valid authorization cannot be redirected to another target.
4. A valid authorization cannot be retargeted to another action.
5. Another token cannot satisfy a token-specific challenge.
6. Expired challenges fail.
7. Direct calls cannot bypass the pool-mediated condition.
8. One user's challenge state cannot consume or strand another user's funds.
9. Prover failure cannot silently mark a clearance successful.
10. Logs cannot expose sensitive witness material.
11. Duplicate client retries cannot create duplicate target actions where idempotency is expected.
12. An external target revert must not strand the threshold capital.
13. The product never claims proof-of-solvency from proof-of-funds.

## 12.4 Prover trust

Document exactly what the prover learns in the shipped architecture.

Do not claim zero-knowledge between the client and prover unless the implemented protocol provides it.

If witness material reaches the prover:

- treat it as sensitive,
- retain only in memory where feasible,
- never log it,
- never place it in D1/analytics,
- document lifecycle,
- redact errors,
- delete temporary files,
- test redaction.

---

# 13. Testing Strategy

Tests support claims. Do not optimize for a vanity test count.

## 13.1 Contract unit tests

At minimum:

- valid challenge succeeds,
- below-threshold path cannot reach target,
- wrong token rejected,
- wrong target rejected,
- wrong action rejected,
- expired challenge rejected,
- replay rejected,
- wrong subject rejected,
- direct call rejected,
- malformed challenge rejected,
- target revert returns/reverts safely,
- duplicate note/value accounting impossible where relevant,
- funds cannot leak across challenges,
- admin cannot forge clearance.

## 13.2 Integration tests

- exact client-generated calldata round-trips through contract parser,
- pool/anonymizer interface matches current upstream code,
- token decimals/base units match,
- challenge hash parity between TypeScript and Cairo,
- mainnet-fork checks where supported,
- prover output accepted by the execution path,
- wallet/provider integration,
- status/error propagation.

## 13.3 Prover tests

- compatible request accepted,
- malformed request rejected before expensive work,
- duplicate request returns original outcome or safely deduplicates,
- service-busy retry works only for transient failures,
- worker death detected,
- queue job not silently lost,
- timeouts produce typed terminal state,
- redaction removes secrets,
- metrics contain no witness data,
- health reflects actual prover readiness, not merely process existence.

## 13.4 UI/E2E tests

Critical path only:

- open demo,
- connect wallet/provider,
- inspect challenge,
- execute,
- success state,
- failure state,
- explorer evidence route.

Do not spend large amounts of time on low-value UI test permutations before the live mechanism works.

---

# 14. Adversarial Evidence Campaign

Run a deterministic local/devnet/fork campaign of at least 100 cases.

Recommended distribution:

```text
25 valid clearances
20 below-threshold attempts
10 expired challenges
10 replay attempts
10 wrong-target attempts
10 wrong-token attempts
5 wrong-subject attempts
5 malformed challenges
5 direct-call bypass attempts
```

Required output:

```json
{
  "total": 100,
  "valid_expected": 25,
  "valid_observed": 25,
  "invalid_expected": 75,
  "invalid_rejected": 75,
  "false_clearances": 0,
  "successful_replays": 0,
  "funds_stranded": 0
}
```

The numbers above are acceptance targets, not pre-existing evidence. Publish actual generated output only after running the campaign.

Save:

- raw case vectors,
- runner,
- machine-readable results,
- human summary,
- commit hash,
- contract artifact hash.

---

# 15. Prover Benchmark Campaign

Run a separate proving reliability campaign.

Aim for 100 proof jobs if resource/time economics allow. If proving is too expensive for 100 full proofs, run the largest honest sample and explain why.

Measure:

- jobs submitted,
- jobs completed,
- terminal failures,
- transient failures,
- recoveries,
- duplicates,
- p50 latency,
- p95 latency,
- peak resident memory,
- CPU allocation,
- queue wait,
- prover image/source revision,
- RPC provider,
- block selection strategy.

Never label one machine's result as a universal STRK20 benchmark.

Raw results belong in:

```text
evidence/benchmarks/
```

---

# 16. Mainnet Evidence Plan

The final build must not stop at local, fork, devnet, or Sepolia.

Required live sequence:

## M1 — eligibility/bootstrap

Obtain the project's first real STRK20 Mainnet state needed for the demo, such as registration/shielding, using the smallest reasonable funded amount.

## M2 — successful Limen challenge

A real SN_MAIN transaction:

```text
private STRK20 state
→ Limen Anonymizer
→ bound target action
→ shielded return
```

Proof generated through the Limen self-hosted proving path.

## M3 — second successful qualifying interaction

Use a second real successful pool-touching transaction so `strk20.json` contains at least three valid mainnet hashes in total.

Prefer a second distinct Limen success over a ceremonial transfer if cost is acceptable.

Do not use a reverted attack transaction as one of the mandatory three unless competition rules explicitly count it.

## Negative mainnet evidence

Do not waste mainnet funds to prove every rejection.

Use deterministic/fork tests for most attacks.

If one low-cost mainnet rejection adds major judge value and the owner approves the spend, it may be added as extra evidence.

---

# 17. Infrastructure and Deployment

## 17.1 Web

Deploy `apps/web` to Cloudflare Workers through Wrangler.

Requirements:

- production build passes,
- no secret in client bundle,
- Cloudflare environment variables used correctly,
- public demo route opens without login,
- GitHub deployment metadata or repository Website points to the live app,
- responsive on desktop and mobile,
- error states work in production.

## 17.2 RPC

Use an Alchemy Starknet Mainnet RPC supplied by the owner when required.

Keep it server-side where possible.

If the browser must use an RPC for wallet-compatible reads, do not expose a privileged paid key unnecessarily. Use a safe public/browser key or wallet provider as appropriate.

## 17.3 Prover host

Start with local Docker for protocol-seam validation.

For the public final product, deploy the prover/gateway to a Docker-capable host.

The agent must ask the owner only when external hosting credentials/payment are required.

Required environment variables should be documented in `.env.example`.

## 17.4 Persistence

Avoid Supabase unless a real need emerges.

Permitted non-sensitive persistence:

- Cloudflare D1,
- Durable Objects,
- local SQLite on the prover gateway,
- another simple store justified in `DECISIONS.md`.

Never store:

- private keys,
- viewing keys,
- raw private witnesses,
- decrypted note data,

in cloud analytics or ordinary application persistence.

---

# 18. Design Requirements

`DESIGN.md` is authoritative.

Adapt the supplied design system to Limen rather than copying another brand's content.

Required character:

- light editorial developer-infrastructure product,
- compact information density,
- white/paper surfaces,
- hairline border structure,
- restrained single-accent use,
- product UI as imagery,
- no stock photos,
- no generic crypto illustration,
- no unnecessary gradients,
- no giant meaningless stat cards,
- no fake terminal window as hero decoration.

The visual hierarchy should make the product feel like serious financial/privacy infrastructure.

## 18.1 Product-specific motifs

Use real interface states:

- threshold challenge,
- capital condition,
- proving job state,
- STRK20 Mainnet badge,
- target/action binding,
- success/failure,
- explorer proof.

A good hero visual is the actual challenge panel transitioning:

```text
Challenge
>= 50 STRK

Private balance
Not disclosed

Provider
Limen Prover

Status
Proving → Accepted → Cleared
```

Do not display a fabricated balance.

---

# 19. Documentation Requirements

Root:

- `README.md`
- `PRD.md`
- `DESIGN.md`
- `ARCHITECTURE.md`
- `SECURITY.md`
- `CONTRIBUTIONS.md`
- `DECISIONS.md`
- `BUILD_LOG.md`
- `SETUP.md`
- `LICENSE`
- `strk20.json`

README opening order:

1. one-line problem,
2. one-line product,
3. dominant mechanism diagram,
4. live demo,
5. mainnet evidence,
6. privacy boundary,
7. run locally,
8. architecture,
9. tests/evidence,
10. limitations.

Do not start README with hackathon badges or a long technology list.

---

# 20. Open-Source Contribution Requirement

Inspect the active STRK20 ecosystem while implementing:

- `starkware-libs/starknet-privacy`,
- starter kit,
- STRK20 skills,
- current docs/examples,
- proving/container tooling.

Look for a real defect or DX gap uncovered by Limen.

Possible classes:

- prover deployment/documentation issue,
- CPU compatibility,
- RPC capability mismatch,
- OHTTP example gap,
- health/readiness semantics,
- retry behavior,
- unclear anonymizer example,
- unsafe default,
- missing test,
- version compatibility confusion.

Do not duplicate an issue already solved by another sprint team.

A contribution only counts when it is real:

- reproduce,
- record old behavior,
- file issue/PR,
- patch/test where appropriate,
- record upstream link in `CONTRIBUTIONS.md`.

No contribution theater.

---

# 21. Claim and Evidence Ledger

Maintain `evidence/claims.json`.

Suggested structure:

```json
[
  {
    "id": "C1",
    "claim": "A below-threshold user cannot execute the gated action.",
    "mechanism": "Pool-mediated threshold capital requirement",
    "test": "campaign/below-threshold",
    "artifact": "evidence/campaigns/security.json",
    "mainnet": false,
    "status": "proven"
  }
]
```

Every important README/demo claim must map to an evidence artifact.

Mandatory claims:

- valid threshold can clear,
- below-threshold cannot clear,
- replay blocked,
- target binding enforced,
- wrong token blocked,
- expired challenge blocked,
- direct bypass blocked,
- funds return correctly,
- self-hosted proving path can produce a mainnet-accepted STRK20 proof,
- at least three qualifying mainnet transactions exist.

---

# 22. Acceptance Gates

The agent must work through these in order.

A later gate does not compensate for an earlier failed core gate.

## G0 — Repository and competition bootstrap

PASS when:

- public repo has code,
- `PRD.md` and `DESIGN.md` present,
- `strk20.json` present,
- license present,
- STRK20 skills installed,
- project registered in sprint registry,
- repo description/topics/website placeholders configured where possible,
- CI skeleton exists.

## G1 — Authoritative protocol map

PASS when:

- current pool address and network verified,
- current SDK version/pin recorded,
- current pool fee read path identified,
- current `privacy_invoke` interface verified from source/reference,
- open-note/return semantics verified,
- current prover request path verified,
- exact blocker/assumption list written to `DECISIONS.md`.

No major contract implementation before this gate.

## G2 — Protocol-seam spike

This is the most important gate.

PASS only when a minimal working experiment demonstrates:

```text
real STRK20-compatible private execution
→ custom Limen anonymizer receives expected value
→ bound action or state transition occurs
→ value can return through the supported private-output path
```

Prefer Mainnet as soon as safely feasible.

If this mechanism is impossible under current STRK20 semantics, stop feature work and report the exact blocker to the owner before changing the product thesis.

## G3 — Contract correctness

PASS when:

- all required contract invariants implemented,
- Cairo tests pass,
- challenge hash parity established,
- replay/target/token/expiry/direct-call cases tested,
- target revert does not strand value,
- threat model updated.

## G4 — Limen self-hosted prover

PASS when:

- pinned prover starts reproducibly,
- valid request generates proof,
- typed health check works,
- gateway validates requests,
- idempotency works,
- worker failure is detected,
- sensitive logs are redacted,
- proof path documented from clean setup.

## G5 — End-to-end local/fork flow

PASS when:

- web/client creates challenge,
- private transaction prepared,
- Limen prover produces proof,
- execution reaches anonymizer,
- target action changes,
- capital return path completes,
- UI displays real result,
- no mock sits in the critical path.

## G6 — First Mainnet Limen proof

PASS only when:

- dedicated project wallet funded,
- self-hosted Limen prover used,
- transaction accepted on SN_MAIN,
- STRK20 pool actually touched,
- Limen anonymizer actually executed,
- target action is externally verifiable,
- returned-capital outcome verified as far as protocol visibility allows,
- tx hash saved under `evidence/mainnet/`,
- README status updated truthfully.

This gate converts the project from candidate to real.

## G7 — Mandatory three Mainnet transactions

PASS when:

- `strk20.json.transactions` contains at least three real qualifying Mainnet hashes,
- every hash independently verifies against the expected pool,
- no placeholder hash,
- no Sepolia hash,
- no duplicate,
- provenance script passes.

## G8 — Security and reliability campaign

PASS when:

- 100-case adversarial campaign completed,
- zero false clearances,
- zero successful replays,
- zero funds stranded in deterministic campaign,
- raw results committed,
- proving benchmark completed honestly.

## G9 — Product completion

PASS when:

- landing explains product in <20 seconds,
- judge can enter demo without private instructions,
- challenge UI complete,
- success/failure states complete,
- developer console uses real data,
- evidence/explorer page works,
- mobile responsive,
- no dead buttons,
- no fake balances,
- no placeholder critical surfaces.

## G10 — Open source and clean room

PASS when:

- tests/lint/typecheck/build pass locally,
- hosted CI passes,
- fresh-clone bootstrap succeeds,
- deterministic tests separated from live tests,
- external requirements documented,
- contribution work recorded,
- repo metadata complete.

## G11 — Production deployment

PASS when:

- Cloudflare Workers deployment live,
- production env correct,
- public URL in GitHub repo,
- prover gateway reachable through intended secure path,
- production critical flow tested once end to end,
- no development-only credentials exposed.

## G12 — Submission

PASS when:

- `strk20.json` complete,
- contract addresses correct,
- demo URL correct,
- three-minute video published,
- README matches delivered architecture,
- all public surfaces use same product name and claims,
- mainnet evidence links work,
- limitations explicit,
- no stale metrics,
- final pre-submission audit passes.

---

# 23. Demo Script Requirements

Target: roughly three minutes.

## Scene 1 — familiar problem

Show a capital-gated action:

```text
Requirement: >= 50 STRK
Your total balance: not requested
```

Explain in one sentence that public wallets normally disclose much more than the application needs.

## Scene 2 — private challenge

Open the Limen challenge.

Show:

- threshold,
- token,
- target,
- expiry,
- privacy disclosure.

Select `Limen Prover`.

## Scene 3 — proof infrastructure

Show a compact real-time state:

```text
request accepted
→ proving
→ proof ready
→ submitted
```

Do not linger on infrastructure.

## Scene 4 — irreversible proof

Mainnet transaction succeeds.

Show:

```text
CLEARED
Target action executed
SN_MAIN
tx 0x...
```

Open explorer evidence.

## Scene 5 — failure path

Run the deterministic/demo failure:

- below threshold, or
- replay of consumed challenge.

Show explicit rejection.

## Scene 6 — close

One architecture visual:

```text
private STRK20 capital
→ Limen proof
→ capital condition
→ action
→ capital returns private
```

Then show the public repo and evidence location.

---

# 24. Business Thesis

Initial users:

- private-market applications,
- OTC desks,
- token allocation platforms,
- private credit products,
- institutional treasury tooling,
- Starknet privacy dapps needing capital qualification.

Value:

- the application learns only the condition it needs,
- user keeps the rest of their shielded position private,
- developers avoid operating the entire proving stack themselves.

Open-source core:

- protocol contracts,
- SDK,
- self-host prover deployment.

Potential commercial layer after the sprint:

- managed proving,
- reserved prover capacity,
- dedicated clusters,
- SLA support,
- enterprise policy integrations,
- hosted developer API.

Do not force monetization into the hackathon UI.

---

# 25. Non-Goals

Do not expand the core build into:

- a general privacy wallet,
- a neobank,
- a payroll app,
- a full OTC venue,
- a lending protocol,
- a proof-of-solvency system,
- a generic identity protocol,
- a new proof system,
- a new privacy pool,
- a token,
- a broad compliance suite,
- a multi-chain product.

These can be future integrations.

The hackathon product is a reusable private-capital authorization primitive plus the proving infrastructure needed to make it work.

---

# 26. Kill Criteria and Escalation

Immediately escalate to the owner if any of these are established:

1. Current STRK20 semantics cannot route threshold capital through a custom anonymizer and safely return it to private state.
2. The self-hosted prover cannot produce a Mainnet-accepted STRK20 proof under the available upstream stack.
3. The only working architecture requires revealing the user's total balance to the target.
4. The only way to issue clearance gives a privileged server/admin the ability to fabricate eligibility.
5. The required Mainnet path depends on unavailable unreleased infrastructure with no self-hosted alternative.

Do not silently redesign the product around a weaker claim.

---

# 27. Owner Inputs Expected

The agent should not ask for these until required.

Likely owner-provided inputs:

- GitHub/registry action permission if not already available,
- Telegram username for registry entry,
- Alchemy Starknet Mainnet RPC key,
- Mainnet funds for:
  - project deployer gas,
  - STRK20 pool fees,
  - minimum demo capital,
- Cloudflare account permission/Wrangler login if not already authenticated,
- Docker host credentials or approval to provision a prover host,
- final public video link or permission to upload/publish it,
- optional domain.

When funding is required, generate the dedicated account first and return only:

```text
Network
Public address
Asset needed
Minimum estimated amount
Why it is needed
```

Never expose the generated private key.

---

# 28. Definition of Done

Limen is done when a fresh judge can:

1. open the public app,
2. understand the problem immediately,
3. see a real Mainnet capital challenge,
4. execute a valid challenge through the Limen self-hosted proving path,
5. observe a real STRK20 Mainnet transaction,
6. see the target action become authorized,
7. verify the public evidence,
8. see an invalid/replay path rejected,
9. inspect the open-source implementation,
10. reproduce the deterministic evidence from a clean clone.

The final project should leave behind three durable artifacts:

```text
1. a new STRK20 capital-authorization primitive
2. reusable STRK20 proving infrastructure
3. reproducible evidence showing both work
```

No acceptance gate is satisfied by documentation alone when the corresponding behavior can be executed.
