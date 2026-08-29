import { CallData, RpcProvider, num, shortString, type Account } from "starknet";
import {
  networkConfig,
  readPoolState,
  isOpenNoteDepositorBlocked,
  type LimenNetwork,
  type NetworkConfig,
  type PoolState,
} from "@limenlabs/protocol-config";
import {
  challengeParamsCalldata,
  computeChallengeId,
  type Challenge,
  type ChallengeParams,
} from "./challenge.js";
import { LimenError, classifyFailure } from "./errors.js";

export interface LimenDeployment {
  readonly network: LimenNetwork;
  readonly anonymizer: string;
  readonly capitalGate: string;
}

export interface LimenReadClientOptions {
  readonly deployment: LimenDeployment;
  readonly provider: RpcProvider;
}

function feltToShortString(felt: string): string {
  const hex = num.toHex(felt).slice(2);
  const decoded = Buffer.from(hex.length % 2 ? `0${hex}` : hex, "hex").toString("ascii");
  return /^[\x20-\x7e]*$/.test(decoded) ? decoded : num.toHex(felt);
}

/**
 * Read-only view of a Limen deployment.
 *
 * Everything here comes from chain. The client holds no cache of challenge state,
 * because a challenge's value is entirely in whether it is still open, and a stale
 * answer to that question is worse than a slow one.
 */
export class LimenReadClient {
  readonly config: NetworkConfig;

  constructor(private readonly options: LimenReadClientOptions) {
    this.config = networkConfig(options.deployment.network);
  }

  get deployment(): LimenDeployment {
    return this.options.deployment;
  }

  get provider(): RpcProvider {
    return this.options.provider;
  }

  /** Live pool parameters, including the fee, which is governance-settable. */
  async poolState(): Promise<PoolState> {
    return readPoolState(this.provider, this.config);
  }

  /** Whether the pool has denied this anonymizer, which would block every clearance. */
  async anonymizerBlocked(): Promise<boolean> {
    return isOpenNoteDepositorBlocked(
      this.provider,
      this.config,
      this.options.deployment.anonymizer
    );
  }

  challengeId(params: ChallengeParams): string {
    return computeChallengeId(this.config.chainId, this.options.deployment.anonymizer, params);
  }

  /**
   * Reads a challenge and its consumption state. Returns null when the identifier is
   * unknown to this deployment, which is a normal answer rather than an error: a
   * challenge id is a public handle anyone may present.
   */
  async getChallenge(challengeId: string): Promise<Challenge | null> {
    const [challengeFelts, statusFelts, openFelts] = await Promise.all([
      this.call("get_challenge", [challengeId]),
      this.call("get_challenge_status", [challengeId]),
      this.call("is_challenge_open", [challengeId]),
    ]);

    const [token, threshold, target, action, subject, issuer, expiresAt] = challengeFelts;
    if (!token || BigInt(token) === 0n) return null;

    const consumedBy = statusFelts[0] ?? "0x0";
    const consumedAt = statusFelts[1] ?? "0x0";

    return {
      challengeId: num.toHex(challengeId),
      token: num.toHex(token),
      threshold: BigInt(threshold ?? "0x0"),
      target: num.toHex(target ?? "0x0"),
      action: feltToShortString(action ?? "0x0"),
      subject: num.toHex(subject ?? "0x0"),
      issuer: num.toHex(issuer ?? "0x0"),
      expiresAt: Number(BigInt(expiresAt ?? "0x0")),
      consumedBy: BigInt(consumedBy) === 0n ? null : num.toHex(consumedBy),
      consumedAt: BigInt(consumedAt) === 0n ? null : Number(BigInt(consumedAt)),
      open: BigInt(openFelts[0] ?? "0x0") === 1n,
    };
  }

  /** Whether a subject has qualified at the reference capital gate. */
  async isQualified(subject: string): Promise<boolean> {
    const result = (await this.provider.callContract({
      contractAddress: this.options.deployment.capitalGate,
      entrypoint: "is_qualified",
      calldata: [num.toHex(subject)],
    }));
    return BigInt(result[0] ?? "0x0") === 1n;
  }

  async clearedCount(): Promise<number> {
    const result = await this.call("get_cleared_count", []);
    return Number(BigInt(result[0] ?? "0x0"));
  }

  /**
   * Re-derives the challenge identifier on chain and compares it with the local
   * derivation. A mismatch means the SDK and the contract disagree about the challenge
   * layout, which must stop a run rather than produce an unreachable challenge.
   */
  async assertChallengeIdParity(params: ChallengeParams): Promise<string> {
    const local = this.challengeId(params);
    const onChain = await this.call("compute_challenge_id", challengeParamsCalldata(params));
    const remote = num.toHex(onChain[0] ?? "0x0");
    if (BigInt(local) !== BigInt(remote)) {
      throw new Error(
        `Challenge id derivation disagrees: sdk ${local}, contract ${remote}. ` +
          "Do not submit; the challenge layout has drifted."
      );
    }
    return local;
  }

  private async call(entrypoint: string, calldata: string[]): Promise<string[]> {
    try {
      return (await this.provider.callContract({
        contractAddress: this.options.deployment.anonymizer,
        entrypoint,
        calldata,
      }));
    } catch (error) {
      throw classifyFailure(error);
    }
  }
}

/**
 * Opens challenges. This is the verifier's side of Limen, and it is deliberately
 * separate from the clearing side: a verifier needs an ordinary Starknet account and
 * never touches private state.
 */
export class LimenIssuer {
  constructor(
    private readonly account: Account,
    private readonly client: LimenReadClient
  ) {}

  async createChallenge(
    params: ChallengeParams
  ): Promise<{ challengeId: string; transactionHash: string }> {
    if (BigInt(params.issuer) !== BigInt(this.account.address)) {
      throw new Error("params.issuer must be the account opening the challenge");
    }
    if (params.threshold <= 0n) throw new LimenError("BELOW_THRESHOLD", "threshold must be positive");
    if (params.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new LimenError("CHALLENGE_EXPIRED", "expiresAt is already in the past");
    }

    const challengeId = await this.client.assertChallengeIdParity(params);

    const call = {
      contractAddress: this.client.deployment.anonymizer,
      entrypoint: "create_challenge",
      calldata: CallData.compile({
        token: params.token,
        threshold: params.threshold,
        target: params.target,
        action: params.action.startsWith("0x")
          ? params.action
          : shortString.encodeShortString(params.action),
        subject: params.subject,
        issuer: params.issuer,
        expires_at: params.expiresAt,
        nonce: params.nonce,
      }),
    };

    const { transaction_hash } = await this.account.execute(call, { tip: 0n });
    await this.client.provider.waitForTransaction(transaction_hash);
    return { challengeId, transactionHash: transaction_hash };
  }
}
