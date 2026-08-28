import type { Metadata } from "next";
import { Card, Dot, Field, NotLive, SectionHead, Tag } from "@/components/primitives";
import { proverHealth, proverJobs, proverMetrics } from "@/lib/gateway";
import { deploymentConfig } from "@/lib/config";
import { poolSnapshot } from "@/lib/chain";
import { formatAmount, STRK_MAINNET, UPSTREAM_PINS } from "@limen/protocol-config";

export const metadata: Metadata = { title: "Developer console" };
// Operational data. Caching it would defeat the point.
export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const config = deploymentConfig();
  const [health, metrics, jobs, pool] = await Promise.all([
    proverHealth(),
    proverMetrics(),
    proverJobs(),
    poolSnapshot(config),
  ]);

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-12">
      <SectionHead
        eyebrow="Developer console"
        title="Limen Prover"
        aside={
          health ? (
            <Tag tone={health.healthy ? "green" : "orange"}>
              <Dot tone={health.healthy ? "green" : "orange"} />
              {health.healthy ? "Healthy" : "Unhealthy"}
            </Tag>
          ) : (
            <Tag tone="muted">
              <Dot tone="grey" />
              Unreachable
            </Tag>
          )
        }
      />

      <p className="mb-8 max-w-[760px] text-[14px] leading-[1.6] text-fog">
        Everything on this page is read live from the prover gateway and from chain. Nothing is
        sampled, averaged over a hidden window, or filled in when a value is missing. Job records
        carry no request content: a proving request contains the user&apos;s viewing key, so
        calldata, signatures and witnesses never reach this surface.
      </p>

      {!config.gatewayUrl ? (
        <NotLive
          what="No prover gateway is configured for this deployment."
          detail="Set LIMEN_GATEWAY_URL to the Cloudflare Tunnel hostname of a running Limen Prover host. See infra/prover/README.md."
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-4 text-[14px] font-medium text-charcoal">Prover</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Status"
              value={
                health ? (
                  <span className="inline-flex items-center gap-2">
                    <Dot tone={health.healthy ? "green" : "orange"} />
                    {health.healthy ? "Serving" : "Not serving"}
                  </span>
                ) : null
              }
              hint={health?.reason}
            />
            <Field label="RPC spec" value={health?.specVersion ?? null} mono />
            <Field
              label="Health probe"
              value={health?.latencyMs !== undefined ? `${health.latencyMs} ms` : null}
            />
            <Field
              label="Active proofs"
              value={metrics ? String(metrics.active) : (health?.activeJobs ?? null)?.toString() ?? null}
            />
            <Field
              label="Queue depth"
              value={metrics ? String(metrics.queued) : (health?.queueDepth ?? null)?.toString() ?? null}
            />
            <Field
              label="Uptime"
              value={metrics ? formatDuration(metrics.uptimeSeconds) : null}
            />
          </div>

          <div className="mt-5 border-t border-ash pt-4">
            <Field
              label="Prover image"
              value={health?.image ?? metrics?.image ?? null}
              mono
              hint="pinned by digest, so a redeploy cannot change it"
            />
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-[14px] font-medium text-charcoal">Proving latency</h3>
          {metrics && metrics.succeeded > 0 ? (
            <div className="grid gap-4">
              <Field label="p50" value={`${(metrics.p50Ms ?? 0) / 1000}s`} />
              <Field label="p95" value={`${(metrics.p95Ms ?? 0) / 1000}s`} />
              <Field label="Proofs completed" value={String(metrics.succeeded)} />
            </div>
          ) : (
            <p className="text-[13px] leading-5 text-fog">
              No proofs completed on this gateway yet. Latency appears once there is something
              real to measure.
            </p>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-4 text-[14px] font-medium text-charcoal">Reliability</h3>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Submitted" value={metrics ? String(metrics.submitted) : null} />
            <Field label="Succeeded" value={metrics ? String(metrics.succeeded) : null} />
            <Field label="Failed" value={metrics ? String(metrics.failed) : null} />
            <Field
              label="Rejected"
              value={metrics ? String(metrics.rejected) : null}
              hint="refused before proving"
            />
            <Field
              label="Deduplicated"
              value={metrics ? String(metrics.deduplicated) : null}
              hint="idempotent replays"
            />
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-4 text-[14px] font-medium text-charcoal">Protocol</h3>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Pool fee"
              value={
                pool.state
                  ? `${formatAmount(pool.state.feeAmount, STRK_MAINNET.decimals)} STRK`
                  : null
              }
              hint="live, per pool transaction"
            />
            <Field label="Pool version" value={pool.state?.version ?? null} mono />
            <Field
              label="Proof validity"
              value={pool.state ? `${pool.state.proofValidityBlocks} blocks` : null}
            />
            <Field label="Pinned pool class" value={UPSTREAM_PINS.poolClassHashMainnet} mono />
            <Field label="SDK" value={UPSTREAM_PINS.privacySdkVersion} mono />
            <Field
              label="Anonymizer denylisted"
              value={
                pool.anonymizerBlocked === null
                  ? null
                  : pool.anonymizerBlocked
                    ? "Yes"
                    : "No"
              }
            />
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <SectionHead eyebrow="Recent activity" title="Proving jobs" />
        {jobs && jobs.length > 0 ? (
          <Card className="overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-ash text-[11px] uppercase tracking-[0.07em] text-fog">
                  <th className="px-4 py-2.5 font-normal">Request</th>
                  <th className="px-4 py-2.5 font-normal">Outcome</th>
                  <th className="px-4 py-2.5 font-normal">Duration</th>
                  <th className="px-4 py-2.5 font-normal">Proving block</th>
                  <th className="px-4 py-2.5 font-normal">Started</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.requestId} className="border-b border-ash last:border-b-0">
                    <td className="mono px-4 py-2.5 text-[12px] text-charcoal">{job.requestId}</td>
                    <td className="px-4 py-2.5 text-[13px]">
                      <span className="inline-flex items-center gap-2">
                        <Dot
                          tone={
                            job.outcome === "succeeded"
                              ? "green"
                              : job.outcome === "running"
                                ? "accent"
                                : "orange"
                          }
                        />
                        {job.outcome}
                        {job.reason ? (
                          <span className="text-[12px] text-fog">({job.reason})</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="mono px-4 py-2.5 text-[12px] text-steel">
                      {job.durationMs ? `${(job.durationMs / 1000).toFixed(1)}s` : "n/a"}
                    </td>
                    <td className="mono px-4 py-2.5 text-[12px] text-steel">
                      {job.blockNumber ?? "n/a"}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-fog">
                      {new Date(job.startedAt).toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <NotLive
            what="No proving jobs to show."
            detail={
              config.gatewayUrl
                ? "The gateway is configured but has recorded no jobs yet, or the console is not authorized to read them."
                : "Configure a prover gateway to see live job records here."
            }
          />
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
