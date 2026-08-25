import type { LimenNetwork } from "./networks.js";

export interface TokenConfig {
  readonly symbol: string;
  readonly name: string;
  readonly address: `0x${string}`;
  /**
   * Base-unit exponent. Every amount Limen handles is an integer of base units;
   * decimals exist only to render and to parse, never to compute.
   */
  readonly decimals: number;
}

export const STRK_MAINNET: TokenConfig = {
  symbol: "STRK",
  name: "Starknet Token",
  address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  decimals: 18,
};

export const ETH_MAINNET: TokenConfig = {
  symbol: "ETH",
  name: "Ether",
  address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
  decimals: 18,
};

export const USDC_MAINNET: TokenConfig = {
  symbol: "USDC",
  name: "USD Coin",
  address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  decimals: 6,
};

const TOKENS: Record<LimenNetwork, readonly TokenConfig[]> = {
  mainnet: [STRK_MAINNET, ETH_MAINNET, USDC_MAINNET],
  sepolia: [],
};

export function tokensFor(network: LimenNetwork): readonly TokenConfig[] {
  return TOKENS[network];
}

export function findToken(network: LimenNetwork, address: string): TokenConfig | undefined {
  const normalized = BigInt(address);
  return tokensFor(network).find((token) => BigInt(token.address) === normalized);
}

/**
 * Parses a human amount into base units without ever touching a float.
 *
 * `Number` cannot represent 18-decimal token amounts, so the string is split and
 * padded rather than multiplied.
 */
export function parseAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Not a valid decimal amount: ${JSON.stringify(value)}`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`${value} has more than ${decimals} decimal places`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/** Renders base units for display. Trailing zeros in the fraction are dropped. */
export function formatAmount(baseUnits: bigint, decimals: number): string {
  const negative = baseUnits < 0n;
  const magnitude = negative ? -baseUnits : baseUnits;
  const divisor = 10n ** BigInt(decimals);
  const whole = magnitude / divisor;
  const fraction = (magnitude % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
