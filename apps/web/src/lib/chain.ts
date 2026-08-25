import "server-only";
import { RpcProvider } from "starknet";
import { readPoolState, isOpenNoteDepositorBlocked, type PoolState } from "@limen/protocol-config";
import { LimenReadClient, type Challenge } from "@limen/sdk";
import { deploymentConfig, isDeployed, type LimenDeploymentConfig } from "./config";

/**
 * Server-side chain access.
 *
 * Every figure the app shows comes from here. There is no cache that could outlive a
 * challenge's consumption, because "is this challenge still open" is the one question
 * where a stale answer is worse than a slow one.
 */

export function provider(config = deploymentConfig()): RpcProvider {
  return new RpcProvider({ nodeUrl: config.rpcUrl });
}

export function readClient(config: LimenDeploymentConfig): LimenReadClient | null {
  if (!isDeployed(config)) return null;
  return new LimenReadClient({
    provider: provider(config),
    deployment: {
      network: config.network.network,
      anonymizer: config.anonymizer!,
      capitalGate: config.capitalGate!,
    },
  });
}

export interface PoolSnapshot {
  state: PoolState | null;
  anonymizerBlocked: boolean | null;
  error: string | null;
}

/**
 * Live pool parameters. The fee in particular is governance-settable and has already
 * moved once during this build, so it is never a constant in the UI.
 */
export async function poolSnapshot(config = deploymentConfig()): Promise<PoolSnapshot> {
  try {
    const rpc = provider(config);
    const state = await readPoolState(rpc, config.network);
    const anonymizerBlocked = config.anonymizer
      ? await isOpenNoteDepositorBlocked(rpc, config.network, config.anonymizer)
      : null;
    return { state, anonymizerBlocked, error: null };
  } catch (error) {
    return { state: null, anonymizerBlocked: null, error: describe(error) };
  }
}

export interface ChallengeSnapshot {
  challenge: Challenge | null;
  error: string | null;
}

export async function challengeSnapshot(challengeId: string): Promise<ChallengeSnapshot> {
  const config = deploymentConfig();
  const client = readClient(config);
  if (!client) return { challenge: null, error: "Limen is not deployed on this network yet." };
  try {
    return { challenge: await client.getChallenge(challengeId), error: null };
  } catch (error) {
    return { challenge: null, error: describe(error) };
  }
}

export async function clearedCount(): Promise<number | null> {
  const client = readClient(deploymentConfig());
  if (!client) return null;
  try {
    return await client.clearedCount();
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Never surface an RPC URL: it can carry a key in its path.
  return text.replace(/https?:\/\/[^\s"']+/g, "<rpc>").slice(0, 240);
}
