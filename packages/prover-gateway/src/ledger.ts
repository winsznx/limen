import { randomUUID } from "node:crypto";

/**
 * Admission control, idempotency and job accounting for the Limen Prover.
 *
 * Single-process and in-memory on purpose. The gateway runs as one container beside
 * the prover on the same host, so a plain object is genuinely serialised, and there is
 * no state here worth surviving a restart: a proof in flight when the process dies is
 * gone either way, and the client's retry is the recovery path.
 *
 * Nothing stored here derives from request content. Counters, durations, outcomes, and
 * a proof result keyed by a client-chosen idempotency key. Never calldata, signatures,
 * or witnesses — which is why `/metrics` and `/jobs` are safe to expose.
 */

export interface JobRecord {
  requestId: string;
  outcome: "running" | "succeeded" | "failed" | "rejected";
  reason?: string;
  durationMs: number;
  blockNumber?: number;
  proofFactsCount?: number;
  startedAt: string;
  finishedAt?: string;
}

export interface GatewayMetrics {
  active: number;
  queued: number;
  submitted: number;
  succeeded: number;
  failed: number;
  rejected: number;
  deduplicated: number;
  recovered: number;
  p50Ms: number | null;
  p95Ms: number | null;
  durationsMs: number[];
  uptimeSeconds: number;
}

export interface LedgerLimits {
  maxConcurrent: number;
  maxQueued: number;
}

const JOB_HISTORY = 100;
const DURATION_WINDOW = 500;

export class Ledger {
  /**
   * Jobs admitted and not yet finished.
   *
   * `active` and `queued` are derived from this rather than tracked separately: two
   * counters that must agree eventually disagree, and a drifted `active` permanently
   * consumes admission slots.
   */
  private inFlight = 0;
  private readonly startedAt = Date.now();
  private counters = {
    submitted: 0,
    succeeded: 0,
    failed: 0,
    rejected: 0,
    deduplicated: 0,
    recovered: 0,
  };
  private durations: number[] = [];
  private jobs: JobRecord[] = [];
  private results = new Map<string, { result: unknown; storedAt: number }>();

  constructor(
    private readonly limits: LedgerLimits,
    private readonly idempotencyTtlMs = 30 * 60 * 1000
  ) {}

  private get active(): number {
    return Math.min(this.inFlight, this.limits.maxConcurrent);
  }

  private get queued(): number {
    return Math.max(0, this.inFlight - this.limits.maxConcurrent);
  }

  admit(): { admitted: true; requestId: string; queueWaitStartedAt: number } | { admitted: false } {
    if (this.inFlight >= this.limits.maxConcurrent + this.limits.maxQueued) {
      this.counters.rejected += 1;
      return { admitted: false };
    }
    this.inFlight += 1;
    this.counters.submitted += 1;

    const requestId = `req_${randomUUID().slice(0, 8)}`;
    this.jobs.unshift({
      requestId,
      outcome: "running",
      durationMs: 0,
      startedAt: new Date().toISOString(),
    });
    this.jobs.length = Math.min(this.jobs.length, JOB_HISTORY);
    return { admitted: true, requestId, queueWaitStartedAt: Date.now() };
  }

  complete(
    requestId: string,
    update: {
      outcome: "succeeded" | "failed";
      reason?: string;
      durationMs: number;
      blockNumber?: number;
      proofFactsCount?: number;
    }
  ): void {
    this.inFlight = Math.max(0, this.inFlight - 1);

    if (update.outcome === "succeeded") {
      this.counters.succeeded += 1;
      this.durations.push(update.durationMs);
      if (this.durations.length > DURATION_WINDOW) this.durations.shift();
    } else {
      this.counters.failed += 1;
    }

    const job = this.jobs.find((entry) => entry.requestId === requestId);
    if (job) {
      Object.assign(job, {
        outcome: update.outcome,
        durationMs: update.durationMs,
        finishedAt: new Date().toISOString(),
        ...(update.reason ? { reason: update.reason } : {}),
        ...(update.blockNumber !== undefined ? { blockNumber: update.blockNumber } : {}),
        ...(update.proofFactsCount !== undefined
          ? { proofFactsCount: update.proofFactsCount }
          : {}),
      });
    }
  }

  /** A transient failure that a retry then recovered from. */
  recordRecovery(): void {
    this.counters.recovered += 1;
  }

  recordRejected(reason: string): void {
    this.counters.rejected += 1;
    this.jobs.unshift({
      requestId: `rejected_${randomUUID().slice(0, 8)}`,
      outcome: "rejected",
      reason,
      durationMs: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    this.jobs.length = Math.min(this.jobs.length, JOB_HISTORY);
  }

  replay(key: string): unknown {
    this.sweep();
    const entry = this.results.get(key);
    if (!entry) return null;
    this.counters.deduplicated += 1;
    return entry.result;
  }

  remember(key: string, result: unknown): void {
    this.sweep();
    this.results.set(key, { result, storedAt: Date.now() });
  }

  metrics(): GatewayMetrics {
    const sorted = [...this.durations].sort((left, right) => left - right);
    const percentile = (fraction: number): number | null => {
      if (sorted.length === 0) return null;
      return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? null;
    };
    return {
      active: this.active,
      queued: this.queued,
      ...this.counters,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      durationsMs: sorted,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  recent(limit = 20): JobRecord[] {
    return this.jobs.slice(0, limit);
  }

  /**
   * Reconciles counters after a crash-and-restart of the prover process. A job that
   * was running when the prover died is terminal, not still in flight, and leaving it
   * counted as active would permanently consume an admission slot.
   */
  releaseStuckJobs(): number {
    const stuck = this.jobs.filter((job) => job.outcome === "running");
    for (const job of stuck) {
      job.outcome = "failed";
      job.reason = "prover_restarted";
      job.finishedAt = new Date().toISOString();
      this.counters.failed += 1;
    }
    this.inFlight = 0;
    return stuck.length;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.idempotencyTtlMs;
    for (const [key, entry] of this.results) {
      if (entry.storedAt <= cutoff) this.results.delete(key);
    }
  }
}
