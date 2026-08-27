import Link from "next/link";
import { formatAmount, STRK_MAINNET } from "@limen/protocol-config";
import { ClearancePanel } from "@/components/clearance-panel";
import { ButtonLink, Card, Dot, Field, FeltLink, SectionHead, Tag } from "@/components/primitives";
import { deploymentConfig, isDeployed } from "@/lib/config";
import { clearedCount, poolSnapshot } from "@/lib/chain";

// Chain state changes under us, and a stale pool fee is a real failure rather than a
// cosmetic one, so the landing page revalidates rather than baking values at build.
export const revalidate = 30;

export default async function HomePage() {
  const config = deploymentConfig();
  const [pool, cleared] = await Promise.all([poolSnapshot(config), clearedCount()]);
  const live = isDeployed(config);

  const poolFee = pool.state ? formatAmount(pool.state.feeAmount, STRK_MAINNET.decimals) : null;

  return (
    <>
      <section className="texture-grid border-b border-ash">
        <div className="mx-auto max-w-[1200px] px-5 py-16 sm:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
            <div>
              <div className="mb-6 flex flex-wrap items-center gap-2">
                <Tag tone="accent">
                  <Dot tone="accent" />
                  STRK20 on Starknet Mainnet
                </Tag>
                <Tag tone="muted">Apache-2.0</Tag>
              </div>

              <h1 className="display text-[40px] text-charcoal sm:text-[48px]">
                Prove enough.
                <br />
                Keep the rest private.
              </h1>

              <p className="mt-6 max-w-[520px] text-[18px] leading-[1.55] text-steel">
                Limen lets Starknet apps require a capital threshold without asking users to
                reveal their total shielded balance.
              </p>

              <p className="mt-4 max-w-[520px] text-[15px] leading-[1.6] text-fog">
                The user mobilises exactly the threshold from valid STRK20 private state through
                the Limen Anonymizer. The bound action executes, and the capital returns to a
                shielded note in the same transaction. If they cannot supply it, nothing clears.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <ButtonLink href="/challenge" variant="primary">
                  Try a capital challenge
                </ButtonLink>
                <ButtonLink href="/protocol">View protocol</ButtonLink>
              </div>

              <dl className="mt-10 grid max-w-[520px] grid-cols-3 gap-px overflow-hidden rounded-[12px] border border-ash bg-ash">
                <Stat
                  label="Pool fee, live"
                  value={poolFee ? `${poolFee} STRK` : null}
                  hint="read from chain"
                />
                <Stat
                  label="Challenges cleared"
                  value={cleared === null ? null : String(cleared)}
                  hint="on this deployment"
                />
                <Stat
                  label="Adversarial cases"
                  value="100 / 100"
                  hint="0 false clearances"
                />
              </dl>
            </div>

            <div className="lg:justify-self-end lg:w-[520px]">
              <ClearancePanel
                threshold="50"
                symbol="STRK"
                target="Capital Gate"
                action="REGISTER_ALLOCATION"
                poolFee={poolFee}
                stage="idle"
              />
              <p className="mt-3 text-[12px] leading-5 text-fog">
                This is the product interface, not an illustration. The balance field is empty
                because Limen never learns it.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-5 py-16">
        <SectionHead
          eyebrow="The mechanism"
          title="One atomic transaction, four things happen"
          aside={
            <Link href="/protocol" className="text-[13px] text-accent hover:underline">
              Read the protocol →
            </Link>
          }
        />

        <ol className="grid gap-px overflow-hidden rounded-[12px] border border-ash bg-ash md:grid-cols-4">
          {[
            {
              step: "01",
              title: "Spend",
              body: "Valid STRK20 notes covering exactly the threshold are spent inside the pool. Which notes, and how much more you hold, stay private.",
            },
            {
              step: "02",
              title: "Withdraw",
              body: "The pool withdraws exactly the threshold to the Limen Anonymizer and publishes what it withdrew, which is what makes the source checkable.",
            },
            {
              step: "03",
              title: "Execute",
              body: "The anonymizer verifies the challenge, measures what actually arrived, and runs the bound action on the target application.",
            },
            {
              step: "04",
              title: "Return",
              body: "The full amount is credited straight back into a shielded open note. Nothing is left in the anonymizer, and no reusable credential survives.",
            },
          ].map((item) => (
            <li key={item.step} className="bg-canvas p-5">
              <div className="mono mb-3 text-[11px] text-silver">{item.step}</div>
              <h3 className="mb-2 text-[15px] font-medium text-charcoal">{item.title}</h3>
              <p className="text-[13px] leading-[1.55] text-fog">{item.body}</p>
            </li>
          ))}
        </ol>

        <p className="mt-4 max-w-[760px] text-[13px] leading-[1.6] text-fog">
          A revert anywhere aborts all of it. A target that refuses, a threshold that is not met,
          an expired or already-used challenge: in every case no capital moves and the challenge
          stays unconsumed.
        </p>
      </section>

      <section className="border-y border-ash bg-paper">
        <div className="mx-auto max-w-[1200px] px-5 py-16">
          <SectionHead
            eyebrow="Privacy boundary"
            title="Stated precisely, because vague claims are worse than none"
          />

          <div className="grid gap-4 md:grid-cols-2">
            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Dot tone="orange" />
                <h3 className="text-[14px] font-medium text-charcoal">Becomes public</h3>
              </div>
              <ul className="space-y-2.5">
                {[
                  "The token and the threshold being proven.",
                  "The target application and the action authorised.",
                  "The challenge identifier, and that it was consumed.",
                  "A subject pseudonym, scoped to this anonymizer only.",
                  "That the pool withdrew the threshold and credited it back.",
                  "The time the transaction landed.",
                ].map((item) => (
                  <li key={item} className="flex gap-2.5 text-[13px] leading-[1.5] text-steel">
                    <span className="mt-[7px] shrink-0">
                      <Dot tone="grey" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-5">
              <div className="mb-4 flex items-center gap-2">
                <Dot tone="green" />
                <h3 className="text-[14px] font-medium text-charcoal">Stays private</h3>
              </div>
              <ul className="space-y-2.5">
                {[
                  "Your total shielded balance.",
                  "How much more than the threshold you hold.",
                  "Which notes you spent, and their amounts.",
                  "Your Starknet address, which the target never receives.",
                  "Your unrelated shielded transfers and positions.",
                  "Your viewing key and your signing key.",
                ].map((item) => (
                  <li key={item} className="flex gap-2.5 text-[13px] leading-[1.5] text-steel">
                    <span className="mt-[7px] shrink-0">
                      <Dot tone="grey" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="mt-4 p-5">
            <h3 className="mb-3 text-[14px] font-medium text-charcoal">
              And the parts that reduce privacy
            </h3>
            <div className="grid gap-2.5 text-[13px] leading-[1.5] text-fog sm:grid-cols-2">
              <p>
                Deposits into and withdrawals out of the pool are public by protocol design. Only
                movement inside the pool is shielded.
              </p>
              <p>
                Timing correlation can link a shielding deposit to a later clearance. Shield well
                ahead of time.
              </p>
              <p>A distinctive threshold narrows the set of users it could have been.</p>
              <p>
                The threshold itself is disclosed to the verifier on purpose. That is what the
                product is for.
              </p>
            </div>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-5 py-16">
        <SectionHead
          eyebrow="Infrastructure"
          title="Limen runs its own proving"
          aside={
            <Link href="/console" className="text-[13px] text-accent hover:underline">
              Live console →
            </Link>
          }
        />
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-5">
            <h3 className="mb-2 text-[14px] font-medium text-charcoal">Self-hosted prover</h3>
            <p className="text-[13px] leading-[1.55] text-fog">
              The pinned upstream STRK20 transaction prover, running as a real Linux container on
              a dedicated host. Limen adds no code inside it, so the artefact producing proofs is
              exactly the published one.
            </p>
          </Card>
          <Card className="p-5">
            <h3 className="mb-2 text-[14px] font-medium text-charcoal">A gateway in front</h3>
            <p className="text-[13px] leading-[1.55] text-fog">
              Authentication, request validation, bounded concurrency, idempotency, worker-failure
              detection and metrics. The prover publishes no port; the gateway is the only way to
              reach it.
            </p>
          </Card>
          <Card className="p-5">
            <h3 className="mb-2 text-[14px] font-medium text-charcoal">Nothing is logged</h3>
            <p className="text-[13px] leading-[1.55] text-fog">
              A proving request carries the user&apos;s viewing key in its calldata. Redaction is
              enforced in code and covered by tests, and no request content reaches a log, a
              metric, or an error.
            </p>
          </Card>
        </div>
      </section>

      <section className="border-t border-ash">
        <div className="mx-auto max-w-[1200px] px-5 py-16">
          <SectionHead
            eyebrow="Status"
            title="What is live right now"
            aside={
              <Link href="/evidence" className="text-[13px] text-accent hover:underline">
                All evidence →
              </Link>
            }
          />
          <div className="grid gap-px overflow-hidden rounded-[12px] border border-ash bg-ash sm:grid-cols-2 lg:grid-cols-4">
            <div className="bg-canvas p-4">
              <Field
                label="STRK20 pool"
                value={<FeltLink value={config.network.poolAddress} network={config.network} kind="contract" />}
                hint={pool.state ? `version ${pool.state.version}` : undefined}
              />
            </div>
            <div className="bg-canvas p-4">
              <Field
                label="Limen Anonymizer"
                value={<FeltLink value={config.anonymizer} network={config.network} kind="contract" />}
                hint={live ? undefined : "not deployed yet"}
              />
            </div>
            <div className="bg-canvas p-4">
              <Field
                label="Capital Gate"
                value={<FeltLink value={config.capitalGate} network={config.network} kind="contract" />}
                hint={live ? undefined : "not deployed yet"}
              />
            </div>
            <div className="bg-canvas p-4">
              <Field
                label="Open-note deposits"
                value={
                  pool.anonymizerBlocked === null
                    ? null
                    : pool.anonymizerBlocked
                      ? "Blocked by the pool"
                      : "Permitted"
                }
                hint="governance denylist"
              />
            </div>
          </div>
          {pool.error ? (
            <p className="mt-3 text-[12px] text-tangerine">
              Chain read failed: {pool.error}
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | null;
  hint: string;
}) {
  return (
    <div className="bg-canvas px-4 py-3.5">
      <dt className="text-[11px] uppercase tracking-[0.07em] text-fog">{label}</dt>
      <dd className="mt-1.5 text-[16px] font-medium text-charcoal">
        {value ?? <span className="text-[14px] font-normal text-silver">Not available</span>}
      </dd>
      <dd className="mt-0.5 text-[11px] text-fog">{hint}</dd>
    </div>
  );
}
