/** Networks Limen is configured for. Mainnet is the only one the product claims. */
export type LimenNetwork = "mainnet" | "sepolia";

export interface NetworkConfig {
  readonly network: LimenNetwork;
  /** Starknet chain identifier, as the felt the pool hashes into challenge ids. */
  readonly chainId: `0x${string}`;
  readonly chainName: string;
  /** STRK20 privacy pool. */
  readonly poolAddress: `0x${string}`;
  readonly explorerTxUrl: (transactionHash: string) => string;
  readonly explorerContractUrl: (address: string) => string;
  /** A declared class, which the explorer indexes separately from its instances. */
  readonly explorerClassUrl: (classHash: string) => string;
}

/**
 * OpenZeppelin account v3, declared on Starknet mainnet.
 *
 * The default class for accounts Limen generates for deployment. Shared so the tool that
 * derives a counterfactual address and the script that deploys it cannot disagree about
 * which class the address was computed from — they would silently land on different
 * addresses.
 */
export const OZ_ACCOUNT_CLASS_HASH =
  "0x00e2eb8f5672af4e6a4e8a8f1b44989685e668489b0a25437733756c5a34a1d6";

const VOYAGER_MAINNET = "https://voyager.online";
const VOYAGER_SEPOLIA = "https://sepolia.voyager.online";

export const MAINNET: NetworkConfig = {
  network: "mainnet",
  chainId: "0x534e5f4d41494e",
  chainName: "SN_MAIN",
  poolAddress: "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  explorerTxUrl: (transactionHash) => `${VOYAGER_MAINNET}/tx/${transactionHash}`,
  explorerContractUrl: (address) => `${VOYAGER_MAINNET}/contract/${address}`,
  explorerClassUrl: (classHash) => `${VOYAGER_MAINNET}/class/${classHash}`,
};

export const SEPOLIA: NetworkConfig = {
  network: "sepolia",
  chainId: "0x534e5f5345504f4c4941",
  chainName: "SN_SEPOLIA",
  poolAddress: "0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91",
  explorerTxUrl: (transactionHash) => `${VOYAGER_SEPOLIA}/tx/${transactionHash}`,
  explorerContractUrl: (address) => `${VOYAGER_SEPOLIA}/contract/${address}`,
  explorerClassUrl: (classHash) => `${VOYAGER_SEPOLIA}/class/${classHash}`,
};

const NETWORKS: Record<LimenNetwork, NetworkConfig> = {
  mainnet: MAINNET,
  sepolia: SEPOLIA,
};

export function networkConfig(network: LimenNetwork): NetworkConfig {
  return NETWORKS[network];
}

/** Resolves a chain id read from a provider back to a configured network. */
export function networkForChainId(chainId: string): NetworkConfig | undefined {
  const normalized = BigInt(chainId);
  return Object.values(NETWORKS).find((entry) => BigInt(entry.chainId) === normalized);
}
