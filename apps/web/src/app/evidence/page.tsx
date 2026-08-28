import type { Metadata } from "next";
import claims from "../../../../../evidence/claims.json";
import campaign from "../../../../../evidence/campaigns/security.json";
import strk20 from "../../../../../strk20.json";
import { Card, Dot, Field, FeltLink, NotLive, SectionHead, Tag, short } from "@/components/primitives";
import { deploymentConfig } from "@/lib/config";
import { poolSnapshot } from "@/lib/chain";

export const metadata: Metadata = { title: "Evidence" };
export const revalidate = 60;

type ClaimStatus = "proven" | "pending" | "not_started";

export default async function EvidencePage() {
  const config = deploymentConfig();
  const pool = await poolSnapshot(config);
  const transactions = strk20.transactions;

  const proven = claims.claims.filter((claim) => claim.status === "proven").length;

  return (
    <div className="mx-auto max-w-300 px-5 py-12">
      <SectionHead
        eyebrow="Evidence"
        title="Every claim, and what proves it"
        aside={
          <Tag tone="muted">
            {proven} of {claims.claims.length} proven
          </Tag>
        }
      />

      <p className="mb-10 max-w-190 text-[14px] leading-[1.6] text-fog">
        A claim counts as proven only when an artefact exists that someone else can regenerate.
        Anything Limen has built and tested but not yet demonstrated end to end says{" "}
        <span className="text-charcoal">pending</span> and names what it is waiting on, rather
        than being reworded into something weaker that would sound finished.
      </p>

      <SectionHead eyebrow="On chain" title="Contracts and transactions" />
      <div className="mb-4 grid gap-px overflow-hidden rounded-[12px] border border-ash bg-ash sm:grid-cols-3">
        <div className="bg-canvas p-4">
          <Field
            label="STRK20 pool"
            value={
              <FeltLink
                value={config.network.poolAddress}
                network={config.network}
                kind="contract"
                lead={10}
                tail={8}
              />
            }
            hint={pool.state ? `version ${pool.state.version}` : "not readable"}
          />
        </div>
        <div className="bg-canvas p-4">
          <Field
            label="Limen Anonymizer"
            value={
              <FeltLink
                value={config.anonymizer}
                network={config.network}
                kind="contract"
                lead={10}
                tail={8}
              />
            }
            hint={config.anonymizer ? undefined : "not deployed yet"}
          />
        </div>
        <div className="bg-canvas p-4">
          <Field
            label="Capital Gate"
            value={
              <FeltLink
                value={config.capitalGate}
                network={config.network}
                kind="contract"
                lead={10}
                tail={8}
              />
            }
            hint={config.capitalGate ? undefined : "not deployed yet"}
          />
        </div>
      </div>

      {transactions.length > 0 ? (
        <Card className="mb-12 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-ash text-[11px] uppercase tracking-[0.07em] text-fog">
                <th className="px-4 py-2.5 font-normal">Transaction</th>
                <th className="px-4 py-2.5 font-normal">Explorer</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((hash) => (
                <tr key={hash} className="border-b border-ash last:border-b-0">
                  <td className="px-4 py-2.5">
                    <a
                      href={config.network.explorerTxUrl(hash)}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={hash}
                      className="felt text-[12px] text-charcoal underline decoration-ash underline-offset-2 transition-colors hover:decoration-accent"
                    >
                      {hash}
                    </a>
                  </td>
                  <td className="px-4 py-2.5">
                    <a
                      href={config.network.explorerTxUrl(hash)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[13px] text-accent hover:underline"
                    >
                      View →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="mb-12">
          <NotLive
            what="No mainnet transactions published yet."
            detail="strk20.json is populated only by scripts/verify-mainnet.ts, which independently re-reads each transaction from chain and refuses any hash whose events do not reconstruct the full mechanism. It will stay empty until that passes."
          />
        </div>
      )}

      <SectionHead
        eyebrow="Adversarial campaign"
        title="100 deterministic cases"
        aside={
          <Tag tone={campaign.passed ? "green" : "orange"}>
            <Dot tone={campaign.passed ? "green" : "orange"} />
            {campaign.passed ? "All cases as specified" : "Failures present"}
          </Tag>
        }
      />

      <div className="mb-4 grid gap-px overflow-hidden rounded-[12px] border border-ash bg-ash sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total cases", value: String(campaign.total) },
          { label: "Valid cleared", value: `${campaign.valid_observed} / ${campaign.valid_expected}` },
          {
            label: "Adversarial rejected",
            value: `${campaign.invalid_rejected} / ${campaign.invalid_expected}`,
          },
          { label: "False clearances", value: String(campaign.false_clearances) },
          { label: "Successful replays", value: String(campaign.successful_replays) },
          { label: "Funds stranded", value: String(campaign.funds_stranded) },
          { label: "Seed", value: campaign.seed, mono: true },
          {
            label: "Commit",
            // A git commit rather than a felt, so it belongs on GitHub, not the explorer.
            value: (
              <a
                href={`https://github.com/winsznx/limen/commit/${campaign.commit}`}
                target="_blank"
                rel="noreferrer noopener"
                title={campaign.commit}
                className="felt text-accent underline decoration-ash underline-offset-2 transition-colors hover:decoration-accent"
              >
                {short(campaign.commit, 8, 6)}
              </a>
            ),
          },
        ].map((item) => (
          <div key={item.label} className="bg-canvas p-4">
            <Field label={item.label} value={item.value} mono={item.mono} />
          </div>
        ))}
      </div>

      <Card className="mb-12 p-5">
        <h3 className="mb-3 text-[14px] font-medium text-charcoal">Distribution</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(campaign.distribution).map(([kind, count]) => (
            <div key={kind} className="flex items-center justify-between text-[13px]">
              <span className="text-steel">{kind.replace(/_/g, " ")}</span>
              <span className="mono text-charcoal">{count}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-ash pt-3 text-[12px] leading-5 text-fog">
          Each case is an independent test, and every adversarial case asserts the exact error it
          must fail with, so a case that fails for the wrong reason counts as a failure rather
          than a pass. Vectors are seeded, so the same commit always produces the same campaign.
          Regenerate with <span className="mono">scripts/generate-campaign.ts</span> and re-run
          with <span className="mono">scripts/run-campaign.ts</span>.
        </p>
      </Card>

      <SectionHead eyebrow="Claim ledger" title="What is proven, and what is not" />
      <div className="space-y-3">
        {claims.claims.map((claim) => (
          <Card key={claim.id} className="p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="mono text-[12px] text-silver">{claim.id}</span>
                <StatusTag status={claim.status as ClaimStatus} />
                {claim.mainnet ? <Tag tone="accent">mainnet</Tag> : null}
              </div>
            </div>
            <p className="mb-3 text-[15px] leading-[1.5] text-charcoal">{claim.claim}</p>
            <p className="mb-3 text-[13px] leading-[1.55] text-fog">{claim.mechanism}</p>
            {"note" in claim && claim.note ? (
              <p className="mb-3 border-l-2 border-ash pl-3 text-[13px] leading-[1.55] text-steel">
                {claim.note}
              </p>
            ) : null}
            {"blocked_on" in claim && claim.blocked_on ? (
              <p className="mb-3 border-l-2 border-tangerine pl-3 text-[13px] leading-[1.55] text-steel">
                Waiting on: {claim.blocked_on as string}
              </p>
            ) : null}
            <div className="mono border-t border-ash pt-3 text-[12px] text-fog">
              {claim.reproduce}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatusTag({ status }: { status: ClaimStatus }) {
  if (status === "proven") {
    return (
      <Tag tone="green">
        <Dot tone="green" />
        Proven
      </Tag>
    );
  }
  if (status === "pending") {
    return (
      <Tag tone="orange">
        <Dot tone="orange" />
        Pending
      </Tag>
    );
  }
  return (
    <Tag tone="muted">
      <Dot tone="grey" />
      Not started
    </Tag>
  );
}
