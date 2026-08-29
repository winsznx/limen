import "server-only";
import { MAINNET, SEPOLIA, type NetworkConfig } from "@limenlabs/protocol-config";

/**
 * Server-side configuration.
 *
 * Every value here is read on the server. None of it is a `NEXT_PUBLIC_` variable,
 * because the RPC URL and the gateway token are credentials and the deployment
 * addresses are served to the browser as ordinary rendered content, not as build-time
 * constants that would freeze at deploy time.
 */

export interface LimenDeploymentConfig {
  network: NetworkConfig;
  /** Null until the contracts are deployed. The UI says so rather than inventing one. */
  anonymizer: string | null;
  capitalGate: string | null;
  /** Bearer-protected prover gateway, reached through the Cloudflare Tunnel. */
  gatewayUrl: string | null;
  rpcUrl: string;
}

/** A public endpoint, used only if no credentialed one is configured. */
const FALLBACK_RPC = "https://rpc.starknet.lava.build";

function normalizeAddress(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(trimmed)) return null;
  if (BigInt(trimmed) === 0n) return null;
  return trimmed;
}

export function deploymentConfig(): LimenDeploymentConfig {
  const network = process.env.LIMEN_NETWORK === "sepolia" ? SEPOLIA : MAINNET;
  return {
    network,
    anonymizer: normalizeAddress(process.env.LIMEN_ANONYMIZER_ADDRESS),
    capitalGate: normalizeAddress(process.env.LIMEN_CAPITAL_GATE_ADDRESS),
    gatewayUrl: process.env.LIMEN_GATEWAY_URL?.trim() || null,
    rpcUrl: process.env.STARKNET_RPC_URL?.trim() || FALLBACK_RPC,
  };
}

/** True once Limen is actually on chain. Gates every surface that would otherwise lie. */
export function isDeployed(config: LimenDeploymentConfig): boolean {
  return Boolean(config.anonymizer && config.capitalGate);
}

export const GATEWAY_TOKEN = () => process.env.LIMEN_GATEWAY_TOKEN?.trim() || null;
