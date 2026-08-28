//! The Limen Anonymizer.
//!
//! A stateful STRK20 anonymizer that turns private capital into a bounded
//! authorisation. The STRK20 pool withdraws exactly the challenge threshold to this
//! contract, calls it, and credits the same amount straight back into a shielded open
//! note. In between, the bound target application runs.
//!
//! ```text
//! UseNote(T)  →  Withdraw(T → Limen)  →  privacy_invoke_with_computation
//!                                             ├── target.limen_execute(...)
//!                                             └── OpenNoteDeposit(T → open note)
//! ```
//!
//! Two properties do the work, and both come from the pool rather than from calldata:
//!
//! 1. **Subject.** The pool derives `identity_key` from the spender's address and
//!    private viewing key inside the proof and hands it to `privacy_compute`. Nobody
//!    can present a subject they do not hold the key for.
//! 2. **Amount.** `privacy_compute` snapshots this contract's token balance at the
//!    proving base, before any value moves, and the proof carries that snapshot into
//!    the invoke. The difference against the balance at execution time is exactly what
//!    the pool withdrew, so a public transfer into this contract cannot stand in for
//!    private capital: it makes the equality fail and the transaction revert.

#[starknet::contract]
pub mod LimenAnonymizer {
    use core::num::traits::{CheckedSub, Zero};
    use limen_anonymizer::interface::ILimenAnonymizer;
    use limen_shared::challenge::{
        Challenge, ChallengeParams, ChallengeStatus, compute_challenge_id,
    };
    use limen_shared::errors;
    use limen_shared::objects::{IERC20Dispatcher, IERC20DispatcherTrait, OpenNoteDeposit};
    use limen_shared::target::{ILimenTargetDispatcher, ILimenTargetDispatcherTrait, LimenClearance};
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{
        ContractAddress, get_block_timestamp, get_caller_address, get_contract_address, get_tx_info,
    };

    #[storage]
    struct Storage {
        /// The one STRK20 pool allowed to drive clearances. Set once, at deployment.
        pool: ContractAddress,
        challenges: Map<felt252, Challenge>,
        challenge_status: Map<felt252, ChallengeStatus>,
        cleared_count: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ChallengeCreated: ChallengeCreated,
        ChallengeCleared: ChallengeCleared,
    }

    /// Public by design: a challenge is a verifier's published requirement.
    #[derive(Drop, starknet::Event)]
    pub struct ChallengeCreated {
        #[key]
        pub challenge_id: felt252,
        #[key]
        pub issuer: ContractAddress,
        #[key]
        pub target: ContractAddress,
        pub token: ContractAddress,
        pub threshold: u128,
        pub action: felt252,
        pub subject: felt252,
        pub expires_at: u64,
    }

    /// Deliberately minimal. It carries the challenge, the pseudonymous subject that
    /// cleared it, and the amount that was already public as the challenge threshold.
    /// It carries no note identifier, no spender address, and nothing about the
    /// subject's remaining balance.
    #[derive(Drop, starknet::Event)]
    pub struct ChallengeCleared {
        #[key]
        pub challenge_id: felt252,
        #[key]
        pub subject: felt252,
        #[key]
        pub target: ContractAddress,
        pub token: ContractAddress,
        pub amount: u128,
        pub action: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, pool: ContractAddress) {
        assert(pool.is_non_zero(), errors::ZERO_POOL);
        self.pool.write(pool);
    }

    #[abi(embed_v0)]
    pub impl LimenAnonymizerImpl of ILimenAnonymizer<ContractState> {
        fn create_challenge(ref self: ContractState, params: ChallengeParams) -> felt252 {
            assert(params.token.is_non_zero(), errors::ZERO_TOKEN);
            assert(params.target.is_non_zero(), errors::ZERO_TARGET);
            assert(params.threshold.is_non_zero(), errors::ZERO_THRESHOLD);
            assert(params.action.is_non_zero(), errors::ZERO_ACTION);
            assert(params.issuer.is_non_zero(), errors::ZERO_ISSUER);
            assert(params.issuer == get_caller_address(), errors::ISSUER_NOT_CALLER);
            assert(params.expires_at > get_block_timestamp(), errors::ALREADY_EXPIRED);

            let challenge_id = self.challenge_id_of(params);
            let entry = self.challenges.entry(challenge_id);
            assert(entry.token.read().is_zero(), errors::CHALLENGE_EXISTS);

            entry
                .write(
                    Challenge {
                        token: params.token,
                        threshold: params.threshold,
                        target: params.target,
                        action: params.action,
                        subject: params.subject,
                        issuer: params.issuer,
                        expires_at: params.expires_at,
                    },
                );

            self
                .emit(
                    ChallengeCreated {
                        challenge_id,
                        issuer: params.issuer,
                        target: params.target,
                        token: params.token,
                        threshold: params.threshold,
                        action: params.action,
                        subject: params.subject,
                        expires_at: params.expires_at,
                    },
                );
            challenge_id
        }

        fn privacy_compute(
            self: @ContractState, identity_key: felt252, challenge_id: felt252,
        ) -> (felt252, felt252, u128) {
            assert(identity_key.is_non_zero(), errors::ZERO_SUBJECT);
            let challenge = self.load_open_challenge(challenge_id);
            assert_subject_matches(challenge.subject, identity_key);

            // Snapshot before any value moves. The proof carries this value forward, so
            // the invoke leg can tell pool-withdrawn capital from a public transfer.
            let balance_before = self.token_balance(challenge.token);
            (identity_key, challenge_id, balance_before)
        }

        fn privacy_invoke_with_computation(
            ref self: ContractState,
            subject: felt252,
            challenge_id: felt252,
            balance_before: u128,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            assert(get_caller_address() == self.pool.read(), errors::CALLER_NOT_POOL);
            assert(subject.is_non_zero(), errors::ZERO_SUBJECT);
            assert(note_id.is_non_zero(), errors::ZERO_NOTE_ID);

            let challenge = self.load_open_challenge(challenge_id);
            assert(get_block_timestamp() <= challenge.expires_at, errors::CHALLENGE_EXPIRED);
            assert_subject_matches(challenge.subject, subject);

            let received = self
                .token_balance(challenge.token)
                .checked_sub(balance_before)
                .expect(errors::BALANCE_DECREASED);
            assert(received >= challenge.threshold, errors::BELOW_THRESHOLD);
            assert(received <= challenge.threshold, errors::ABOVE_THRESHOLD);

            // Consume before the external call. The pool's reentrancy guard already
            // blocks a second `apply_actions`, and the pool is the only caller this
            // entry point accepts, but the ordering keeps the invariant local.
            self
                .challenge_status
                .entry(challenge_id)
                .write(
                    ChallengeStatus { consumed_by: subject, consumed_at: get_block_timestamp() },
                );
            self.cleared_count.write(self.cleared_count.read() + 1);

            ILimenTargetDispatcher { contract_address: challenge.target }
                .limen_execute(
                    LimenClearance {
                        challenge_id,
                        subject,
                        token: challenge.token,
                        amount: received,
                        action: challenge.action,
                        issuer: challenge.issuer,
                    },
                );

            // The pool pulls the capital back out of this contract itself.
            let approved = IERC20Dispatcher { contract_address: challenge.token }
                .approve(spender: self.pool.read(), amount: received.into());
            assert(approved, errors::APPROVE_FAILED);

            self
                .emit(
                    ChallengeCleared {
                        challenge_id,
                        subject,
                        target: challenge.target,
                        token: challenge.token,
                        amount: received,
                        action: challenge.action,
                    },
                );

            [OpenNoteDeposit { note_id, token: challenge.token, amount: received }].span()
        }

        fn get_challenge(self: @ContractState, challenge_id: felt252) -> Challenge {
            self.challenges.entry(challenge_id).read()
        }

        fn get_challenge_status(self: @ContractState, challenge_id: felt252) -> ChallengeStatus {
            self.challenge_status.entry(challenge_id).read()
        }

        fn is_challenge_open(self: @ContractState, challenge_id: felt252) -> bool {
            let challenge = self.challenges.entry(challenge_id).read();
            challenge.token.is_non_zero()
                && self.challenge_status.entry(challenge_id).read().consumed_by.is_zero()
                && get_block_timestamp() <= challenge.expires_at
        }

        fn compute_challenge_id(self: @ContractState, params: ChallengeParams) -> felt252 {
            self.challenge_id_of(params)
        }

        fn get_pool(self: @ContractState) -> ContractAddress {
            self.pool.read()
        }

        fn get_cleared_count(self: @ContractState) -> u64 {
            self.cleared_count.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn challenge_id_of(self: @ContractState, params: ChallengeParams) -> felt252 {
            compute_challenge_id(
                chain_id: get_tx_info().unbox().chain_id, limen: get_contract_address(), :params,
            )
        }

        /// Reads a challenge that exists and has not been consumed. Expiry is checked
        /// by the caller, because `privacy_compute` runs against the proving base
        /// while the invoke leg runs against the executing block, and only the latter
        /// is authoritative for time.
        fn load_open_challenge(self: @ContractState, challenge_id: felt252) -> Challenge {
            let challenge = self.challenges.entry(challenge_id).read();
            assert(challenge.token.is_non_zero(), errors::CHALLENGE_NOT_FOUND);
            assert(
                self.challenge_status.entry(challenge_id).read().consumed_by.is_zero(),
                errors::CHALLENGE_CONSUMED,
            );
            challenge
        }

        fn token_balance(self: @ContractState, token: ContractAddress) -> u128 {
            IERC20Dispatcher { contract_address: token }
                .balance_of(account: get_contract_address())
                .try_into()
                .expect(errors::BALANCE_OVERFLOW)
        }
    }

    /// A zero `required` means the challenge is a bearer challenge: any subject may
    /// clear it, and the subject that does is recorded on consumption.
    fn assert_subject_matches(required: felt252, presented: felt252) {
        assert(required.is_zero() || required == presented, errors::WRONG_SUBJECT);
    }
}
