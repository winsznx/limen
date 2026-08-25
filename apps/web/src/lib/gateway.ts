import "server-only";
import { deploymentConfig, GATEWAY_TOKEN } from "./config";

/**
 * Server-side access to the Limen Prover Gateway.
 *
 * The bearer token never reaches the browser: the console renders on the server and
 * ships only the resulting numbers. Health is read without the token so the console
 * can still say "unreachable" rather than "unauthorized" when the host is down.
 */

export interface ProverHealth {
  healthy: boolean;
  kind: string;
  name: string;
  specVersion?: string;
  latencyMs?: number;
  activeJobs?: number;
  queueDepth?: number;
  image?: string;
  reason?: string;
  checkedAt: string;
}

export interface ProverMetrics {
  active: number;
  queued: number;
  submitted: number;
  succeeded: number;
  failed: number;
  rejected: number;
  deduplicated: number;
  p50Ms: number | null;
  p95Ms: number | null;
  uptimeSeconds: number;
  image?: string;
}

export interface ProverJob {
  requestId: string;
  outcome: string;
  reason?: string;
  durationMs: number;
  blockNumber?: number;
  proofFactsCount?: number;
  startedAt: string;
  finishedAt?: string;
}

const TIMEOUT_MS = 8_000;

async function get<T>(path: string, withToken: boolean): Promise<T | null> {
  const { gatewayUrl } = deploymentConfig();
  if (!gatewayUrl) return null;
  const token = GATEWAY_TOKEN();
  if (withToken && !token) return null;

  try {
    const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}${path}`, {
      headers: withToken ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    // A 503 from /health is a real answer, not a failure to read.
    if (!response.ok && response.status !== 503) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function proverHealth(): Promise<ProverHealth | null> {
  return get<ProverHealth>("/health", false);
}

export function proverMetrics(): Promise<ProverMetrics | null> {
  return get<ProverMetrics>("/metrics", true);
}

export async function proverJobs(): Promise<ProverJob[] | null> {
  const payload = await get<{ jobs: ProverJob[] }>("/jobs", true);
  return payload?.jobs ?? null;
}
