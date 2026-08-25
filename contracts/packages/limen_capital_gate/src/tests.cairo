//! The reference target's own guarantees, tested without Limen in the picture.
//!
//! A target application is the party that must not be fooled, so its checks have to
//! hold on their own rather than relying on the anonymizer being well behaved.

use limen_capital_gate::interface::{
    ACTION_REGISTER_ALLOCATION, ICapitalGateDispatcher, ICapitalGateDispatcherTrait,
};
use limen_shared::target::{ILimenTargetDispatcher, ILimenTargetDispatcherTrait, LimenClearance};
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, cheat_caller_address, declare,
};
use starknet::ContractAddress;

const ONE_TOKEN: u128 = 1_000_000_000_000_000_000;
const MIN_AMOUNT: u128 = 10 * ONE_TOKEN;

fn address(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn limen() -> ContractAddress {
    address(0x11e3)
}

fn token() -> ContractAddress {
    address(0x70ce4)
}

fn deploy_gate() -> ContractAddress {
    let contract = declare("CapitalGate").unwrap().contract_class();
    let (deployed, _) = contract
        .deploy(@array![limen().into(), token().into(), MIN_AMOUNT.into()])
        .unwrap();
    deployed
}

fn clearance(challenge_id: felt252, subject: felt252, amount: u128) -> LimenClearance {
    LimenClearance {
        challenge_id,
        subject,
        token: token(),
        amount,
        action: ACTION_REGISTER_ALLOCATION,
        issuer: address(0x1550e2),
    }
}

fn execute_as_limen(gate: ContractAddress, clearance: LimenClearance) {
    cheat_caller_address(gate, limen(), CheatSpan::TargetCalls(1));
    ILimenTargetDispatcher { contract_address: gate }.limen_execute(clearance);
}

#[test]
fn a_clearance_from_limen_registers_an_allocation() {
    let gate_address = deploy_gate();
    let gate = ICapitalGateDispatcher { contract_address: gate_address };

    execute_as_limen(gate_address, clearance(0x1, 0x5b1, MIN_AMOUNT));

    assert!(gate.is_qualified(0x5b1));
    assert_eq!(gate.get_allocation(0x1).amount, MIN_AMOUNT);
    assert_eq!(gate.get_allocation(0x1).subject, 0x5b1);
    assert_eq!(gate.get_allocation_count(), 1);
}

#[test]
#[should_panic(expected: 'GATE_CALLER_NOT_LIMEN')]
fn nobody_but_limen_can_register_an_allocation() {
    let gate_address = deploy_gate();
    cheat_caller_address(gate_address, address(0xbad), CheatSpan::TargetCalls(1));
    ILimenTargetDispatcher { contract_address: gate_address }
        .limen_execute(clearance(0x1, 0x5b1, MIN_AMOUNT));
}

#[test]
#[should_panic(expected: 'GATE_UNKNOWN_ACTION')]
fn an_unrecognised_action_is_refused() {
    let gate_address = deploy_gate();
    let mut bad = clearance(0x1, 0x5b1, MIN_AMOUNT);
    bad.action = 'SOMETHING_ELSE';
    execute_as_limen(gate_address, bad);
}

#[test]
#[should_panic(expected: 'GATE_WRONG_TOKEN')]
fn capital_in_the_wrong_token_is_refused() {
    let gate_address = deploy_gate();
    let mut bad = clearance(0x1, 0x5b1, MIN_AMOUNT);
    bad.token = address(0x07e2);
    execute_as_limen(gate_address, bad);
}

#[test]
#[should_panic(expected: 'GATE_AMOUNT_TOO_LOW')]
fn an_amount_below_the_gates_own_minimum_is_refused() {
    let gate_address = deploy_gate();
    execute_as_limen(gate_address, clearance(0x1, 0x5b1, MIN_AMOUNT - 1));
}

#[test]
#[should_panic(expected: 'GATE_ALLOCATION_EXISTS')]
fn one_challenge_cannot_register_two_allocations() {
    let gate_address = deploy_gate();
    execute_as_limen(gate_address, clearance(0x1, 0x5b1, MIN_AMOUNT));
    execute_as_limen(gate_address, clearance(0x1, 0x5b1, MIN_AMOUNT));
}

#[test]
#[should_panic(expected: 'LIMEN_ZERO_SUBJECT')]
fn an_anonymous_clearance_with_no_subject_is_refused() {
    let gate_address = deploy_gate();
    execute_as_limen(gate_address, clearance(0x1, 0, MIN_AMOUNT));
}

#[test]
fn distinct_challenges_accumulate_for_the_same_subject() {
    let gate_address = deploy_gate();
    let gate = ICapitalGateDispatcher { contract_address: gate_address };

    execute_as_limen(gate_address, clearance(0x1, 0x5b1, MIN_AMOUNT));
    execute_as_limen(gate_address, clearance(0x2, 0x5b1, MIN_AMOUNT * 2));

    assert_eq!(gate.get_subject_allocation_count(0x5b1), 2);
    assert_eq!(gate.get_allocation_count(), 2);
    assert_eq!(gate.get_allocation(0x2).amount, MIN_AMOUNT * 2);
}

#[test]
fn the_gate_never_records_an_address() {
    let gate_address = deploy_gate();
    let gate = ICapitalGateDispatcher { contract_address: gate_address };
    execute_as_limen(gate_address, clearance(0x1, 0x5b1, MIN_AMOUNT));

    // The only identity in the record is the pseudonymous subject.
    let allocation = gate.get_allocation(0x1);
    assert_eq!(allocation.subject, 0x5b1);
    assert_eq!(allocation.token, token());
}

#[test]
fn the_gates_configuration_is_readable_and_fixed_at_deployment() {
    let gate = ICapitalGateDispatcher { contract_address: deploy_gate() };
    assert_eq!(gate.get_limen(), limen());
    assert_eq!(gate.get_required_token(), token());
    assert_eq!(gate.get_min_amount(), MIN_AMOUNT);
}
