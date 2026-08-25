#[starknet::interface]
pub trait ITargetProbe<T> {
    fn last_subject(self: @T) -> felt252;
    fn last_amount(self: @T) -> u128;
    fn last_challenge(self: @T) -> felt252;
    fn call_count(self: @T) -> u32;
}

/// Records what it was told, and nothing else. Used to assert the clearance payload.
#[starknet::contract]
pub mod RecordingTarget {
    use limen_shared::target::{ILimenTarget, LimenClearance};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use super::ITargetProbe;

    #[storage]
    struct Storage {
        last_subject: felt252,
        last_amount: u128,
        last_challenge: felt252,
        call_count: u32,
    }

    #[abi(embed_v0)]
    pub impl LimenTargetImpl of ILimenTarget<ContractState> {
        fn limen_execute(ref self: ContractState, clearance: LimenClearance) {
            self.last_subject.write(clearance.subject);
            self.last_amount.write(clearance.amount);
            self.last_challenge.write(clearance.challenge_id);
            self.call_count.write(self.call_count.read() + 1);
        }
    }

    #[abi(embed_v0)]
    pub impl ProbeImpl of ITargetProbe<ContractState> {
        fn last_subject(self: @ContractState) -> felt252 {
            self.last_subject.read()
        }
        fn last_amount(self: @ContractState) -> u128 {
            self.last_amount.read()
        }
        fn last_challenge(self: @ContractState) -> felt252 {
            self.last_challenge.read()
        }
        fn call_count(self: @ContractState) -> u32 {
            self.call_count.read()
        }
    }
}

/// Always reverts. Proves an unhappy target aborts the whole pool transaction rather
/// than stranding the threshold capital in the anonymizer.
#[starknet::contract]
pub mod RevertingTarget {
    use limen_shared::target::{ILimenTarget, LimenClearance};

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    pub impl LimenTargetImpl of ILimenTarget<ContractState> {
        fn limen_execute(ref self: ContractState, clearance: LimenClearance) {
            let _ = clearance;
            core::panic_with_felt252('TARGET_REVERTED');
        }
    }
}

/// Calls straight back into the anonymizer while holding the clearance, trying to
/// clear the same challenge twice inside one transaction.
#[starknet::contract]
pub mod ReentrantTarget {
    use limen_shared::target::{ILimenTarget, LimenClearance};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::syscalls::call_contract_syscall;
    use starknet::{ContractAddress, SyscallResultTrait};

    #[storage]
    struct Storage {
        anonymizer: ContractAddress,
        note_id: felt252,
    }

    #[constructor]
    fn constructor(ref self: ContractState, anonymizer: ContractAddress, note_id: felt252) {
        self.anonymizer.write(anonymizer);
        self.note_id.write(note_id);
    }

    #[abi(embed_v0)]
    pub impl LimenTargetImpl of ILimenTarget<ContractState> {
        fn limen_execute(ref self: ContractState, clearance: LimenClearance) {
            call_contract_syscall(
                address: self.anonymizer.read(),
                entry_point_selector: selector!("privacy_invoke_with_computation"),
                calldata: [clearance.subject, clearance.challenge_id, 0, self.note_id.read()]
                    .span(),
            )
                .unwrap_syscall();
        }
    }
}

/// Accepts the clearance and immediately tries to move the anonymizer's capital, to
/// confirm a target cannot spend what it is only being told about.
#[starknet::contract]
pub mod GreedyTarget {
    use limen_anonymizer::test_contracts::mock_erc20::{
        IMockERC20Dispatcher, IMockERC20DispatcherTrait,
    };
    use limen_shared::target::{ILimenTarget, LimenClearance};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_contract_address};

    #[storage]
    struct Storage {
        anonymizer: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, anonymizer: ContractAddress) {
        self.anonymizer.write(anonymizer);
    }

    #[abi(embed_v0)]
    pub impl LimenTargetImpl of ILimenTarget<ContractState> {
        fn limen_execute(ref self: ContractState, clearance: LimenClearance) {
            IMockERC20Dispatcher { contract_address: clearance.token }
                .transfer_from(
                    sender: self.anonymizer.read(),
                    recipient: get_contract_address(),
                    amount: clearance.amount.into(),
                );
        }
    }
}
