//! Reference target application for Limen.
//!
//! A capital-gated allocation register: to take a seat you must clear a Limen
//! challenge, which means privately mobilising at least the gate's minimum through the
//! STRK20 pool. The gate learns the amount that was mobilised, which was already
//! public as the challenge threshold, and a pseudonymous subject identifier. It never
//! learns an address, a note, or a balance.
//!
//! It is deliberately small. Its job is to prove Limen can authorise a real contract
//! action, not to be a second product.

#[starknet::contract]
pub mod CapitalGate {
    use core::num::traits::Zero;
    use limen_capital_gate::interface::{ACTION_REGISTER_ALLOCATION, Allocation, ICapitalGate};
    use limen_shared::errors;
    use limen_shared::target::{ILimenTarget, LimenClearance};
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};

    #[storage]
    struct Storage {
        limen: ContractAddress,
        required_token: ContractAddress,
        min_amount: u128,
        allocations: Map<felt252, Allocation>,
        subject_allocation_count: Map<felt252, u32>,
        allocation_count: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        AllocationRegistered: AllocationRegistered,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AllocationRegistered {
        #[key]
        pub challenge_id: felt252,
        #[key]
        pub subject: felt252,
        pub token: ContractAddress,
        pub amount: u128,
        pub seat: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        limen: ContractAddress,
        required_token: ContractAddress,
        min_amount: u128,
    ) {
        assert(limen.is_non_zero(), errors::ZERO_TARGET);
        assert(required_token.is_non_zero(), errors::ZERO_TOKEN);
        assert(min_amount.is_non_zero(), errors::ZERO_THRESHOLD);
        self.limen.write(limen);
        self.required_token.write(required_token);
        self.min_amount.write(min_amount);
    }

    #[abi(embed_v0)]
    pub impl LimenTargetImpl of ILimenTarget<ContractState> {
        fn limen_execute(ref self: ContractState, clearance: LimenClearance) {
            assert(get_caller_address() == self.limen.read(), errors::CALLER_NOT_LIMEN);
            assert(clearance.action == ACTION_REGISTER_ALLOCATION, errors::UNKNOWN_ACTION);
            assert(clearance.token == self.required_token.read(), errors::WRONG_TOKEN);
            assert(clearance.amount >= self.min_amount.read(), errors::AMOUNT_TOO_LOW);
            assert(clearance.subject.is_non_zero(), errors::ZERO_SUBJECT);

            let entry = self.allocations.entry(clearance.challenge_id);
            assert(entry.subject.read().is_zero(), errors::ALLOCATION_EXISTS);

            let seat = self.allocation_count.read() + 1;
            entry
                .write(
                    Allocation {
                        subject: clearance.subject,
                        token: clearance.token,
                        amount: clearance.amount,
                        registered_at: get_block_timestamp(),
                    },
                );
            self.allocation_count.write(seat);
            let subject_entry = self.subject_allocation_count.entry(clearance.subject);
            subject_entry.write(subject_entry.read() + 1);

            self
                .emit(
                    AllocationRegistered {
                        challenge_id: clearance.challenge_id,
                        subject: clearance.subject,
                        token: clearance.token,
                        amount: clearance.amount,
                        seat,
                    },
                );
        }
    }

    #[abi(embed_v0)]
    pub impl CapitalGateImpl of ICapitalGate<ContractState> {
        fn get_allocation(self: @ContractState, challenge_id: felt252) -> Allocation {
            self.allocations.entry(challenge_id).read()
        }

        fn get_subject_allocation_count(self: @ContractState, subject: felt252) -> u32 {
            self.subject_allocation_count.entry(subject).read()
        }

        fn is_qualified(self: @ContractState, subject: felt252) -> bool {
            self.subject_allocation_count.entry(subject).read() > 0
        }

        fn get_allocation_count(self: @ContractState) -> u64 {
            self.allocation_count.read()
        }

        fn get_min_amount(self: @ContractState) -> u128 {
            self.min_amount.read()
        }

        fn get_required_token(self: @ContractState) -> ContractAddress {
            self.required_token.read()
        }

        fn get_limen(self: @ContractState) -> ContractAddress {
            self.limen.read()
        }
    }
}
