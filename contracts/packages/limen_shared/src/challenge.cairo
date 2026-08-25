use core::poseidon::poseidon_hash_span;
use starknet::ContractAddress;

/// Domain-separation tag for Limen challenge identifiers. Bumping the version makes
/// every previously issued identifier unreachable, which is the intended effect of a
/// breaking change to the challenge layout.
pub const CHALLENGE_TAG: felt252 = 'LIMEN_CHALLENGE:V1';

/// A capital-threshold challenge issued by a verifier application.
///
/// A challenge is a *request*, not a grant: creating one authorises nothing. It only
/// becomes an authorisation when a subject mobilises `threshold` of `token` through the
/// STRK20 pool into the Limen Anonymizer.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Challenge {
    /// ERC-20 whose capital satisfies the challenge.
    pub token: ContractAddress,
    /// Exact amount of `token` that must reach the anonymizer, in base units.
    pub threshold: u128,
    /// Contract whose `limen_execute` runs when the challenge clears.
    pub target: ContractAddress,
    /// Application-defined action identifier passed through to `target`.
    pub action: felt252,
    /// Limen subject identifier permitted to clear this challenge. Zero means bearer:
    /// any subject may clear it, and the subject that does is recorded on consumption.
    pub subject: felt252,
    /// Address that created the challenge. Bound into the identifier so no one can
    /// issue a challenge attributed to another verifier.
    pub issuer: ContractAddress,
    /// Unix seconds after which the challenge can no longer clear.
    pub expires_at: u64,
}

/// Inputs a verifier supplies to open a challenge. Everything here is bound into the
/// challenge identifier, so any change produces a different challenge.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct ChallengeParams {
    pub token: ContractAddress,
    pub threshold: u128,
    pub target: ContractAddress,
    pub action: felt252,
    pub subject: felt252,
    pub issuer: ContractAddress,
    pub expires_at: u64,
    /// Verifier-chosen uniqueness value. Two challenges with identical parameters and
    /// the same nonce collide on identifier, and the second creation reverts.
    pub nonce: felt252,
}

/// One-time-use record. `consumed_by` is zero until the challenge clears, then holds
/// the subject identifier that cleared it.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct ChallengeStatus {
    pub consumed_by: felt252,
    pub consumed_at: u64,
}

/// Derives the challenge identifier.
///
/// `chain_id` and `limen` are part of the preimage so a challenge issued for one chain
/// or one Limen deployment can never be presented to another. The TypeScript SDK
/// reproduces this derivation; `limen_shared::tests::test_challenge` pins the vectors
/// both sides agree on.
pub fn compute_challenge_id(
    chain_id: felt252, limen: ContractAddress, params: ChallengeParams,
) -> felt252 {
    poseidon_hash_span(
        [
            CHALLENGE_TAG,
            chain_id,
            limen.into(),
            params.token.into(),
            params.threshold.into(),
            params.target.into(),
            params.action,
            params.subject,
            params.issuer.into(),
            params.expires_at.into(),
            params.nonce,
        ]
            .span(),
    )
}
