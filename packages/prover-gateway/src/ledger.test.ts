import { describe, expect, it } from "vitest";
import { Ledger } from "./ledger.js";

const limits = { maxConcurrent: 1, maxQueued: 2 };

describe("admission control", () => {
  it("admits up to concurrency plus queue, then refuses", () => {
    const ledger = new Ledger(limits);
    expect(ledger.admit().admitted).toBe(true);
    expect(ledger.admit().admitted).toBe(true);
    expect(ledger.admit().admitted).toBe(true);
    // Bounded means bounded: the fourth is refused so the prover is never
    // oversubscribed.
    expect(ledger.admit().admitted).toBe(false);
    expect(ledger.metrics().rejected).toBe(1);
  });

  it("frees a slot when a job completes", () => {
    const ledger = new Ledger({ maxConcurrent: 1, maxQueued: 0 });
    const first = ledger.admit();
    expect(ledger.admit().admitted).toBe(false);

    if (first.admitted) ledger.complete(first.requestId, { outcome: "succeeded", durationMs: 100 });
    expect(ledger.admit().admitted).toBe(true);
  });

  it("does not let the active count go negative on a duplicate completion", () => {
    const ledger = new Ledger(limits);
    const job = ledger.admit();
    if (!job.admitted) throw new Error("expected admission");
    ledger.complete(job.requestId, { outcome: "succeeded", durationMs: 10 });
    ledger.complete(job.requestId, { outcome: "succeeded", durationMs: 10 });
    expect(ledger.metrics().active).toBe(0);
  });
});

describe("idempotency", () => {
  it("replays a stored result instead of proving twice", () => {
    const ledger = new Ledger(limits);
    ledger.remember("key-1", { proof: "AAA" });
    expect(ledger.replay("key-1")).toEqual({ proof: "AAA" });
    expect(ledger.metrics().deduplicated).toBe(1);
  });

  it("returns nothing for an unknown key", () => {
    expect(new Ledger(limits).replay("never-seen")).toBeNull();
  });

  it("expires a stored result once its window passes", () => {
    const ledger = new Ledger(limits, 0);
    ledger.remember("key-1", { proof: "AAA" });
    expect(ledger.replay("key-1")).toBeNull();
  });
});

describe("worker failure detection", () => {
  it("releases jobs stranded by a prover restart", () => {
    // A job running when the prover dies is terminal, not in flight. Leaving it
    // counted as active would consume an admission slot permanently and wedge the
    // gateway at "busy" for good.
    const ledger = new Ledger(limits);
    ledger.admit();
    ledger.admit();
    // One proving, one waiting: `active` is capped by the concurrency limit and the
    // remainder shows as queue depth.
    expect(ledger.metrics().active).toBe(1);
    expect(ledger.metrics().queued).toBe(1);

    expect(ledger.releaseStuckJobs()).toBe(2);
    expect(ledger.metrics().active).toBe(0);
    expect(ledger.metrics().queued).toBe(0);
    expect(ledger.metrics().failed).toBe(2);
    expect(ledger.admit().admitted).toBe(true);
  });

  it("records why a stranded job failed", () => {
    const ledger = new Ledger(limits);
    ledger.admit();
    ledger.releaseStuckJobs();
    expect(ledger.recent()[0]?.reason).toBe("prover_restarted");
  });

  it("leaves finished jobs alone", () => {
    const ledger = new Ledger(limits);
    const job = ledger.admit();
    if (!job.admitted) throw new Error("expected admission");
    ledger.complete(job.requestId, { outcome: "succeeded", durationMs: 50 });
    expect(ledger.releaseStuckJobs()).toBe(0);
    expect(ledger.metrics().succeeded).toBe(1);
  });
});

describe("metrics", () => {
  it("reports percentiles over successful proofs only", () => {
    const ledger = new Ledger({ maxConcurrent: 10, maxQueued: 0 });
    for (const durationMs of [100, 200, 300, 400, 1000]) {
      const job = ledger.admit();
      if (job.admitted) ledger.complete(job.requestId, { outcome: "succeeded", durationMs });
    }
    const failed = ledger.admit();
    if (failed.admitted) ledger.complete(failed.requestId, { outcome: "failed", durationMs: 99_999 });

    const metrics = ledger.metrics();
    expect(metrics.succeeded).toBe(5);
    expect(metrics.failed).toBe(1);
    expect(metrics.p50Ms).toBe(300);
    // The failed job's duration must not distort the latency picture.
    expect(metrics.durationsMs).not.toContain(99_999);
  });

  it("reports nothing rather than zero when there is no data", () => {
    const metrics = new Ledger(limits).metrics();
    expect(metrics.p50Ms).toBeNull();
    expect(metrics.p95Ms).toBeNull();
  });

  it("keeps a bounded job history", () => {
    const ledger = new Ledger({ maxConcurrent: 1000, maxQueued: 0 });
    for (let index = 0; index < 250; index += 1) ledger.admit();
    expect(ledger.recent(1000).length).toBeLessThanOrEqual(100);
  });
});
