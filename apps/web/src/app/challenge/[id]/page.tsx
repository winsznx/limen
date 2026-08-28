import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatAmount, findToken, STRK_MAINNET } from "@limen/protocol-config";
import { disclosureFor } from "@limen/sdk";
import { ClearancePanel } from "@/components/clearance-panel";
import { Card, Dot, Field, FeltLink, Row, SectionHead, Tag, short } from "@/components/primitives";
import { deploymentConfig } from "@/lib/config";
import { challengeSnapshot, poolSnapshot } from "@/lib/chain";
import { proverHealth } from "@/lib/gateway";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Challenge ${short(id, 8, 6)}` };
}

export default async function ChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(id)) notFound();

  const config = deploymentConfig();
  const [{ challenge, error }, pool, health] = await Promise.all([
    challengeSnapshot(id),
    poolSnapshot(config),
    proverHealth(),
  ]);

  if (!challenge) {
    return (
      <div className="mx-auto max-w-[760px] px-5 py-16">
        <SectionHead eyebrow="Challenge" title="Not found" />
        <Card className="p-5">
          <p className="text-[14px] leading-6 text-steel">
            {error ??
              "No challenge with this identifier exists on this Limen deployment. A challenge identifier is bound to the chain and to the deployment that issued it, so one from another network or another deployment will never resolve here."}
          </p>
          <p className="felt mt-4 text-[12px] text-fog">{id}</p>
        </Card>
      </div>
    );
  }

  const token = findToken(config.network.network, challenge.token);
  const decimals = token?.decimals ?? STRK_MAINNET.decimals;
  const symbol = token?.symbol ?? "tokens";
  const threshold = formatAmount(challenge.threshold, decimals);
  const disclosure = disclosureFor(challenge, symbol);
  const poolFee = pool.state ? formatAmount(pool.state.feeAmount, STRK_MAINNET.decimals) : null;

  const now = Math.floor(Date.now() / 1000);
  const state = challenge.consumedBy
    ? ("cleared" as const)
    : challenge.expiresAt <= now
      ? ("expired" as const)
      : ("open" as const);

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-12">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div>
          <SectionHead
            eyebrow="Capital challenge"
            title={`Prove ≥ ${threshold} ${symbol}`}
            aside={
              <Tag tone={state === "cleared" ? "green" : state === "expired" ? "muted" : "accent"}>
                <Dot tone={state === "cleared" ? "green" : state === "expired" ? "grey" : "accent"} />
                {state === "cleared" ? "Cleared" : state === "expired" ? "Expired" : "Open"}
              </Tag>
            }
          />

          <Card className="mb-6 px-4">
            <Row label="Challenge">
              {/* An identifier the anonymizer derives, not an on-chain address. */}
              <span className="felt text-[12px]">{challenge.challengeId}</span>
            </Row>
            <Row label="Token">
              <span className="mono">
                {symbol} ·{" "}
                <FeltLink
                  value={challenge.token}
                  network={config.network}
                  kind="contract"
                  lead={6}
                  tail={4}
                />
              </span>
            </Row>
            <Row label="Threshold">
              <span className="mono">
                {threshold} {symbol}
              </span>
            </Row>
            <Row label="Target">
              <FeltLink value={challenge.target} network={config.network} kind="contract" />
            </Row>
            <Row label="Action">
              <span className="mono">{challenge.action}</span>
            </Row>
            <Row label="Subject">
              {BigInt(challenge.subject) === 0n ? (
                <span className="text-fog">Any subject (bearer)</span>
              ) : (
                /* A pseudonym scoped to this anonymizer. It is not an address, so it
                   deliberately does not link anywhere. */
                <span className="mono" title={challenge.subject}>
                  {short(challenge.subject, 8, 6)}
                </span>
              )}
            </Row>
            <Row label="Issuer">
              <FeltLink value={challenge.issuer} network={config.network} kind="contract" />
            </Row>
            <Row label="Expires">
              {new Date(challenge.expiresAt * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC
            </Row>
            {challenge.consumedBy ? (
              <Row label="Cleared by">
                {/* The subject that cleared it, again a pseudonym rather than an address. */}
                <span className="mono" title={challenge.consumedBy}>
                  {short(challenge.consumedBy, 8, 6)}
                </span>
              </Row>
            ) : null}
          </Card>

          <SectionHead eyebrow="Before you sign" title="What this discloses" />
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Dot tone="orange" />
                <h3 className="text-[13px] font-medium text-charcoal">Becomes public</h3>
              </div>
              <ul className="space-y-2">
                {disclosure.becomesPublic.map((line) => (
                  <li key={line} className="text-[13px] leading-[1.5] text-steel">
                    {line}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <Dot tone="green" />
                <h3 className="text-[13px] font-medium text-charcoal">Stays private</h3>
              </div>
              <ul className="space-y-2">
                {disclosure.staysPrivate.map((line) => (
                  <li key={line} className="text-[13px] leading-[1.5] text-steel">
                    {line}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="mb-3 text-[13px] font-medium text-charcoal">
              What reduces privacy anyway
            </h3>
            <ul className="space-y-2">
              {disclosure.caveats.map((line) => (
                <li key={line} className="text-[13px] leading-[1.5] text-fog">
                  {line}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <ClearancePanel
            threshold={threshold}
            symbol={symbol}
            target={short(challenge.target, 6, 4)}
            action={challenge.action}
            poolFee={poolFee}
            network={config.network.chainName}
            stage={state === "cleared" ? "cleared" : "idle"}
          />

          <Card className="mt-4 p-5">
            <h3 className="mb-3 text-[13px] font-medium text-charcoal">Clearing this challenge</h3>
            {state !== "open" ? (
              <p className="text-[13px] leading-[1.6] text-fog">
                {state === "cleared"
                  ? "This challenge has already been cleared. Challenges are single-use, and a second attempt is rejected on chain before any capital moves."
                  : "This challenge has expired. Expiry is checked against the executing block, so a proof generated before expiry still fails if it lands after."}
              </p>
            ) : (
              <>
                <p className="mb-4 text-[13px] leading-[1.6] text-fog">
                  Clearing runs through the Privacy SDK, because subject binding needs the
                  pool&apos;s <span className="mono">ComputeAndInvoke</span> action and the Wallet
                  API does not expose it yet.
                </p>
                <pre className="mono overflow-x-auto rounded-[8px] border border-ash bg-paper p-3 text-[11px] leading-[1.7] text-charcoal">
                  {`import { buildClearancePlan } from "@limen/sdk";

const plan = buildClearancePlan({
  challenge, notes, anonymizer,
});`}
                </pre>
                <p className="mt-3 text-[12px] leading-5 text-fog">
                  Requires a registered STRK20 account holding at least {threshold} {symbol}{" "}
                  shielded, plus the pool fee
                  {poolFee ? ` of ${poolFee} STRK` : ""} and gas, both from the public balance.{" "}
                  <a
                    href="https://github.com/winsznx/limen/blob/main/docs/INTEGRATING.md"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent underline decoration-ash underline-offset-2 hover:decoration-accent"
                  >
                    Integration guide
                  </a>
                  {" · "}
                  <a
                    href="https://github.com/winsznx/limen/blob/main/scripts/mainnet-clearance.ts"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent underline decoration-ash underline-offset-2 hover:decoration-accent"
                  >
                    working example
                  </a>
                </p>
              </>
            )}
          </Card>

          <Card className="mt-4 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[13px] font-medium text-charcoal">Proving provider</h3>
              <Tag tone={health?.healthy ? "green" : "muted"}>
                <Dot tone={health?.healthy ? "green" : "grey"} />
                {health?.healthy ? "Ready" : "Unavailable"}
              </Tag>
            </div>
            <Field
              label="Provider"
              value="Limen Prover"
              hint="self-hosted, pinned upstream image"
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
