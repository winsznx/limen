import { num, type RpcProvider } from "starknet";

/**
 * The STRK20 pool's view surface, read straight from chain over JSON-RPC.
 *
 * This exists so Limen can discover notes without a discovery service. The SDK's
 * `ContractDiscoveryProvider` needs exactly this interface, and satisfying it from an
 * RPC provider removes the last third party from the private path: a discovery request
 * carries viewing-key material, and the service that answers it decrypts the request
 * content. Limen's dedicated account has a handful of notes, so scanning the contract
 * directly is cheap, and nothing about the account's activity leaves the client.
 *
 * Method names and return shapes are taken from the deployed class
 * `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`.
 *
 * See DECISIONS.md D-014.
 */

export interface EncChannelInfo {
  ephemeral_pubkey: string;
  enc_channel_key: string;
  enc_sender_addr: string;
}

export interface EncSubchannelInfo {
  salt: string;
  enc_token: string;
}

export interface EncOutgoingChannelInfo {
  salt: string;
  enc_recipient_addr: string;
}

export interface NoteData {
  packed_value: string;
  token: string;
}

export interface EncPrivateKey {
  auditor_public_key: string;
  ephemeral_pubkey: string;
  enc_private_key: string;
}

export interface PoolViews {
  channel_exists(channelMarker: bigint | string): Promise<boolean>;
  get_num_of_channels(recipientAddr: bigint | string): Promise<bigint>;
  get_channel_info(recipientAddr: bigint | string, channelIndex: bigint | number): Promise<EncChannelInfo>;
  subchannel_exists(subchannelMarker: bigint | string): Promise<boolean>;
  get_subchannel_info(subchannelId: bigint | string): Promise<EncSubchannelInfo>;
  get_outgoing_channel_info(outgoingChannelId: bigint | string): Promise<EncOutgoingChannelInfo>;
  get_note(noteId: bigint | string): Promise<NoteData>;
  nullifier_exists(nullifier: bigint | string): Promise<boolean>;
  get_public_key(userAddr: bigint | string): Promise<string>;
  get_enc_private_key(userAddr: bigint | string): Promise<EncPrivateKey>;
  get_auditor_public_key(): Promise<string>;
  get_fee_amount(): Promise<bigint>;
  get_fee_collector(): Promise<string>;
  get_proof_validity_blocks(): Promise<bigint>;
}

/**
 * Builds a pool view reader over an RPC provider.
 *
 * Reads are pinned to a block when one is supplied. Discovery walks many entries, and
 * letting the underlying block advance mid-scan would produce a view of the pool that
 * never existed at any single moment.
 */
export function createPoolViews(
  provider: RpcProvider,
  poolAddress: string,
  blockIdentifier: string | number = "latest"
): PoolViews {
  async function call(entrypoint: string, calldata: Array<bigint | string | number> = []) {
    return (await provider.callContract(
      {
        contractAddress: poolAddress,
        entrypoint,
        calldata: calldata.map((value) => num.toHex(value)),
      },
      blockIdentifier
    ));
  }

  const felt = (values: string[], index: number): string => num.toHex(values[index] ?? "0x0");
  const bool = (values: string[]): boolean => BigInt(values[0] ?? "0x0") !== 0n;
  const big = (values: string[]): bigint => BigInt(values[0] ?? "0x0");

  return {
    async channel_exists(channelMarker) {
      return bool(await call("channel_exists", [channelMarker]));
    },
    async get_num_of_channels(recipientAddr) {
      return big(await call("get_num_of_channels", [recipientAddr]));
    },
    async get_channel_info(recipientAddr, channelIndex) {
      const values = await call("get_channel_info", [recipientAddr, channelIndex]);
      return {
        ephemeral_pubkey: felt(values, 0),
        enc_channel_key: felt(values, 1),
        enc_sender_addr: felt(values, 2),
      };
    },
    async subchannel_exists(subchannelMarker) {
      return bool(await call("subchannel_exists", [subchannelMarker]));
    },
    async get_subchannel_info(subchannelId) {
      const values = await call("get_subchannel_info", [subchannelId]);
      return { salt: felt(values, 0), enc_token: felt(values, 1) };
    },
    async get_outgoing_channel_info(outgoingChannelId) {
      const values = await call("get_outgoing_channel_info", [outgoingChannelId]);
      return { salt: felt(values, 0), enc_recipient_addr: felt(values, 1) };
    },
    async get_note(noteId) {
      const values = await call("get_note", [noteId]);
      return { packed_value: felt(values, 0), token: felt(values, 1) };
    },
    async nullifier_exists(nullifier) {
      return bool(await call("nullifier_exists", [nullifier]));
    },
    async get_public_key(userAddr) {
      return felt(await call("get_public_key", [userAddr]), 0);
    },
    async get_enc_private_key(userAddr) {
      const values = await call("get_enc_private_key", [userAddr]);
      return {
        auditor_public_key: felt(values, 0),
        ephemeral_pubkey: felt(values, 1),
        enc_private_key: felt(values, 2),
      };
    },
    async get_auditor_public_key() {
      return felt(await call("get_auditor_public_key"), 0);
    },
    async get_fee_amount() {
      return big(await call("get_fee_amount"));
    },
    async get_fee_collector() {
      return felt(await call("get_fee_collector"), 0);
    },
    async get_proof_validity_blocks() {
      return big(await call("get_proof_validity_blocks"));
    },
  };
}
