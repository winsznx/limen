use limen_shared::challenge::{Challenge, ChallengeParams, ChallengeStatus};
use limen_shared::objects::OpenNoteDeposit;
use starknet::ContractAddress;

#[starknet::interface]
pub trait ILimenAnonymizer<T> {
    /// Opens a capital-threshold challenge and returns its identifier.
    ///
    /// Permissionless: any verifier can ask for capital to be proven. The caller is
    /// recorded as `issuer` and bound into the identifier, so a challenge cannot be
    /// attributed to a verifier that did not open it. Opening a challenge grants
    /// nothing on its own.
    ///
    /// #### Reverts
    /// - `LIMEN_ZERO_TOKEN` / `LIMEN_ZERO_TARGET` / `LIMEN_ZERO_THRESHOLD` /
    ///   `LIMEN_ZERO_ACTION` — malformed parameters.
    /// - `LIMEN_ISSUER_NOT_CALLER` — `params.issuer` is not the caller.
    /// - `LIMEN_ALREADY_EXPIRED` — `params.expires_at` is not in the future.
    /// - `LIMEN_CHALLENGE_EXISTS` — the identifier is already in use, which is how
    ///   nonce reuse is rejected.
    fn create_challenge(ref self: T, params: ChallengeParams) -> felt252;

    /// Runs inside the proven STRK20 compilation, before any value moves.
    ///
    /// The pool calls this with an `identity_key` it derives from the spender's address
    /// and private viewing key, which is why the subject cannot be forged. The return
    /// value is bound into the proof and delivered verbatim to
    /// `privacy_invoke_with_computation`, which is why the balance snapshot cannot be
    /// forged either.
    ///
    /// Returns `(subject, challenge_id, balance_before)`.
    ///
    /// #### Reverts
    /// - `LIMEN_ZERO_SUBJECT`, `LIMEN_CHALLENGE_NOT_FOUND`,
    ///   `LIMEN_CHALLENGE_CONSUMED`, `LIMEN_WRONG_SUBJECT`, `LIMEN_BALANCE_OVERFLOW`.
    fn privacy_compute(
        self: @T, identity_key: felt252, challenge_id: felt252,
    ) -> (felt252, felt252, u128);

    /// Clears a challenge. Called by the STRK20 pool only, in the same transaction as
    /// the withdrawal that funds it.
    ///
    /// The first three arguments are the `privacy_compute` result the proof carries;
    /// `note_id` is the open note the pool created for the return leg.
    ///
    /// Measures what the pool actually withdrew as `balance_now - balance_before`,
    /// requires it to equal the challenge threshold exactly, marks the challenge
    /// consumed, runs the bound target action, and instructs the pool to credit the
    /// full amount back to the open note.
    ///
    /// #### Reverts
    /// - `LIMEN_CALLER_NOT_POOL` — anything other than the pinned pool called it.
    /// - `LIMEN_CHALLENGE_NOT_FOUND`, `LIMEN_CHALLENGE_CONSUMED`,
    ///   `LIMEN_CHALLENGE_EXPIRED`, `LIMEN_WRONG_SUBJECT`.
    /// - `LIMEN_BELOW_THRESHOLD` / `LIMEN_ABOVE_THRESHOLD` — the measured capital is
    ///   not exactly the threshold.
    /// - Any revert from the target application, which aborts the whole pool
    ///   transaction and moves no funds.
    fn privacy_invoke_with_computation(
        ref self: T,
        subject: felt252,
        challenge_id: felt252,
        balance_before: u128,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;

    /// The challenge behind `challenge_id`. All fields are zero if it does not exist.
    fn get_challenge(self: @T, challenge_id: felt252) -> Challenge;

    /// Consumption record. `consumed_by` is zero while the challenge is unconsumed.
    fn get_challenge_status(self: @T, challenge_id: felt252) -> ChallengeStatus;

    /// Whether the challenge exists, is unconsumed, and has not expired at the current
    /// block timestamp.
    fn is_challenge_open(self: @T, challenge_id: felt252) -> bool;

    /// The identifier `create_challenge` would derive for these parameters. Lets a
    /// verifier compute the identifier before submitting, and lets the SDK check its
    /// own derivation against the contract.
    fn compute_challenge_id(self: @T, params: ChallengeParams) -> felt252;

    /// The STRK20 pool this deployment accepts clearances from. Immutable.
    fn get_pool(self: @T) -> ContractAddress;

    /// Number of challenges cleared by this deployment.
    fn get_cleared_count(self: @T) -> u64;
}
