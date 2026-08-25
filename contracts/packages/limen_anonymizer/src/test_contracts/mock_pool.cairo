use limen_shared::objects::OpenNoteDeposit;
use starknet::ContractAddress;

/// Faithful stand-in for the STRK20 pool's `ComputeAndInvoke` path, reproduced from the
/// class deployed at `0x0403...812a`.
///
/// It exists so contract tests exercise the real sequence rather than a convenient
/// approximation of it:
///
/// 1. `compile` derives `identity_key = h(IDENTITY_KEY_TAG, user_addr,
///    user_private_key, anonymizer)` and calls `privacy_compute` by raw selector,
///    before any value has moved. In the real protocol this runs at the proving base.
/// 2. `apply` transfers the withdrawal to the anonymizer, calls
///    `privacy_invoke_with_computation` by raw selector with
///    `[...compute_result, ...invoke_additional_data]`, deserializes the return as
///    `Span<OpenNoteDeposit>` and rejects trailing data, then pulls each deposit with
///    `transfer_from`.
///
/// Splitting the two lets a test insert activity between proving and execution, which
/// is where the public-transfer attack lives.
#[starknet::interface]
pub trait IMockPool<T> {
    fn compile(
        ref self: T,
        anonymizer: ContractAddress,
        user_addr: ContractAddress,
        user_private_key: felt252,
        challenge_id: felt252,
    ) -> Span<felt252>;

    fn apply(
        ref self: T,
        anonymizer: ContractAddress,
        token: ContractAddress,
        withdraw_amount: u128,
        compute_result: Span<felt252>,
        invoke_additional_data: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;

    /// Convenience wrapper: compile and apply back to back, the ordinary case.
    fn clear(
        ref self: T,
        anonymizer: ContractAddress,
        token: ContractAddress,
        user_addr: ContractAddress,
        user_private_key: felt252,
        challenge_id: felt252,
        withdraw_amount: u128,
        note_id: felt252,
    ) -> Span<OpenNoteDeposit>;

    /// Calls the anonymizer's plain `privacy_invoke`, which Limen does not implement.
    fn plain_invoke(
        ref self: T, anonymizer: ContractAddress, calldata: Span<felt252>,
    ) -> Span<felt252>;

    fn identity_key_for(
        self: @T,
        user_addr: ContractAddress,
        user_private_key: felt252,
        anonymizer: ContractAddress,
    ) -> felt252;
}

#[starknet::contract]
pub mod MockPool {
    use core::poseidon::poseidon_hash_span;
    use limen_anonymizer::test_contracts::mock_erc20::{
        IMockERC20Dispatcher, IMockERC20DispatcherTrait,
    };
    use limen_shared::objects::OpenNoteDeposit;
    use starknet::syscalls::call_contract_syscall;
    use starknet::{ContractAddress, SyscallResultTrait, get_contract_address};
    use super::IMockPool;

    /// From `privacy::hashes::domain_separation`.
    const IDENTITY_KEY_TAG: felt252 = 'IDENTITY_KEY_TAG:V1';

    #[storage]
    struct Storage {}

    /// Mirrors `privacy::events::Withdrawal`. The real pool publishes the recipient and
    /// the amount it paid out, which is the signal Limen's verifier uses to confirm
    /// that a clearance was funded from the pool rather than topped up publicly.
    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Withdrawal: Withdrawal,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Withdrawal {
        #[key]
        pub to_addr: ContractAddress,
        #[key]
        pub token: ContractAddress,
        pub amount: u128,
    }

    #[abi(embed_v0)]
    pub impl MockPoolImpl of IMockPool<ContractState> {
        fn compile(
            ref self: ContractState,
            anonymizer: ContractAddress,
            user_addr: ContractAddress,
            user_private_key: felt252,
            challenge_id: felt252,
        ) -> Span<felt252> {
            let identity_key = identity_key(user_addr, user_private_key, anonymizer);
            call_contract_syscall(
                address: anonymizer,
                entry_point_selector: selector!("privacy_compute"),
                calldata: [identity_key, challenge_id].span(),
            )
                .unwrap_syscall()
        }

        fn apply(
            ref self: ContractState,
            anonymizer: ContractAddress,
            token: ContractAddress,
            withdraw_amount: u128,
            compute_result: Span<felt252>,
            invoke_additional_data: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            let erc20 = IMockERC20Dispatcher { contract_address: token };
            if withdraw_amount != 0 {
                erc20.transfer(recipient: anonymizer, amount: withdraw_amount.into());
                self
                    .emit(
                        Withdrawal { to_addr: anonymizer, token, amount: withdraw_amount },
                    );
            }

            let mut calldata: Array<felt252> = array![];
            calldata.append_span(compute_result);
            calldata.append_span(invoke_additional_data);

            let mut return_data = call_contract_syscall(
                address: anonymizer,
                entry_point_selector: selector!("privacy_invoke_with_computation"),
                calldata: calldata.span(),
            )
                .unwrap_syscall();

            let deposits: Span<OpenNoteDeposit> = Serde::deserialize(ref return_data)
                .expect('INVALID_INVOKE_RETURN_DATA');
            assert(return_data.is_empty(), 'INVALID_INVOKE_RETURN_DATA');

            for deposit in deposits {
                let OpenNoteDeposit { note_id: _, token: deposit_token, amount } = *deposit;
                assert(amount != 0, 'ZERO_AMOUNT');
                IMockERC20Dispatcher { contract_address: deposit_token }
                    .transfer_from(
                        sender: anonymizer,
                        recipient: get_contract_address(),
                        amount: amount.into(),
                    );
            }
            deposits
        }

        fn clear(
            ref self: ContractState,
            anonymizer: ContractAddress,
            token: ContractAddress,
            user_addr: ContractAddress,
            user_private_key: felt252,
            challenge_id: felt252,
            withdraw_amount: u128,
            note_id: felt252,
        ) -> Span<OpenNoteDeposit> {
            let compute_result = self.compile(anonymizer, user_addr, user_private_key, challenge_id);
            self.apply(anonymizer, token, withdraw_amount, compute_result, [note_id].span())
        }

        fn plain_invoke(
            ref self: ContractState, anonymizer: ContractAddress, calldata: Span<felt252>,
        ) -> Span<felt252> {
            call_contract_syscall(
                address: anonymizer,
                entry_point_selector: selector!("privacy_invoke"),
                :calldata,
            )
                .unwrap_syscall()
        }

        fn identity_key_for(
            self: @ContractState,
            user_addr: ContractAddress,
            user_private_key: felt252,
            anonymizer: ContractAddress,
        ) -> felt252 {
            identity_key(user_addr, user_private_key, anonymizer)
        }
    }

    fn identity_key(
        user_addr: ContractAddress, user_private_key: felt252, contract_address: ContractAddress,
    ) -> felt252 {
        poseidon_hash_span(
            [IDENTITY_KEY_TAG, user_addr.into(), user_private_key, contract_address.into()].span(),
        )
    }
}
