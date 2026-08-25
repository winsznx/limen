//! Execution harness for the generated adversarial campaign.
//!
//! Every case drives the same pool sequence the real protocol uses — compute at the
//! proving base, then withdraw, invoke, and pull — and additionally asserts the fund
//! invariants that a pass/fail alone would not catch: the anonymizer must never retain
//! threshold capital, and the pool must end a successful clearance holding exactly what
//! it started with.

use limen_anonymizer::interface::ILimenAnonymizerDispatcherTrait;
use limen_anonymizer::test_contracts::mock_erc20::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};
use limen_anonymizer::test_contracts::mock_pool::IMockPoolDispatcherTrait;
use limen_capital_gate::interface::{ICapitalGateDispatcher, ICapitalGateDispatcherTrait};
use limen_shared::challenge::ChallengeParams;
use snforge_std::{CheatSpan, cheat_block_timestamp, cheat_caller_address};
use super::fixtures::{
    EXPIRES_AT, Fixture, NOTE_ID, NOW, ONE_TOKEN, USER_PRIVATE_KEY, address, base_params, create,
    deploy, setup, user,
};

fn tokens(amount: u128) -> u128 {
    amount * ONE_TOKEN
}

fn params_with(fixture: Fixture, threshold_tokens: u128, nonce: felt252) -> ChallengeParams {
    let mut params = base_params(fixture);
    params.threshold = tokens(threshold_tokens);
    params.nonce = nonce;
    params
}

/// Drives the full pool sandwich at `timestamp`.
fn drive(fixture: Fixture, challenge_id: felt252, withdraw: u128, timestamp: u64) {
    cheat_block_timestamp(fixture.limen.contract_address, timestamp, CheatSpan::TargetCalls(4));
    cheat_block_timestamp(fixture.gate, timestamp, CheatSpan::TargetCalls(2));
    fixture
        .pool
        .clear(
            fixture.limen.contract_address,
            fixture.token.contract_address,
            user(),
            USER_PRIVATE_KEY,
            challenge_id,
            withdraw,
            NOTE_ID,
        );
}

/// A clearance that must succeed, with the fund invariants checked either side.
pub fn run_valid(threshold_tokens: u128, nonce: felt252, clear_offset: u64) {
    let fixture = setup();
    let params = params_with(fixture, threshold_tokens, nonce);
    let challenge_id = create(fixture, params);

    let pool_before = fixture.token.balance_of(fixture.pool.contract_address);
    drive(fixture, challenge_id, tokens(threshold_tokens), NOW + clear_offset);

    assert(
        fixture.limen.get_challenge_status(challenge_id).consumed_by == fixture.subject,
        'CAMPAIGN_NOT_CLEARED',
    );
    assert(
        ICapitalGateDispatcher { contract_address: fixture.gate }
            .get_allocation(challenge_id)
            .amount == tokens(threshold_tokens),
        'CAMPAIGN_NO_ALLOCATION',
    );
    assert(
        fixture.token.balance_of(fixture.limen.contract_address) == 0, 'CAMPAIGN_FUNDS_STRANDED',
    );
    assert(
        fixture.token.balance_of(fixture.pool.contract_address) == pool_before,
        'CAMPAIGN_POOL_IMBALANCE',
    );
}

pub fn run_below_threshold(threshold_tokens: u128, withdraw_tokens: u128, nonce: felt252) {
    let fixture = setup();
    let challenge_id = create(fixture, params_with(fixture, threshold_tokens, nonce));
    drive(fixture, challenge_id, tokens(withdraw_tokens), NOW);
}

pub fn run_expired(threshold_tokens: u128, nonce: felt252, past_expiry: u64) {
    let fixture = setup();
    let challenge_id = create(fixture, params_with(fixture, threshold_tokens, nonce));
    drive(fixture, challenge_id, tokens(threshold_tokens), EXPIRES_AT + past_expiry);
}

pub fn run_replay(threshold_tokens: u128, nonce: felt252) {
    let fixture = setup();
    let challenge_id = create(fixture, params_with(fixture, threshold_tokens, nonce));
    drive(fixture, challenge_id, tokens(threshold_tokens), NOW);
    // The first clearance succeeded. The second must not.
    drive(fixture, challenge_id, tokens(threshold_tokens), NOW);
}

/// A challenge pointed at a gate that trusts a different Limen deployment. The gate
/// must refuse it, which is what stops a challenge being redirected to an application
/// that never opted in.
pub fn run_wrong_target(threshold_tokens: u128, nonce: felt252) {
    let fixture = setup();
    let other_limen = address(0x07e2141);
    let foreign_gate = deploy(
        "CapitalGate",
        array![other_limen.into(), fixture.token.contract_address.into(), tokens(1).into()],
    );

    let mut params = params_with(fixture, threshold_tokens, nonce);
    params.target = foreign_gate;
    let challenge_id = create(fixture, params);
    drive(fixture, challenge_id, tokens(threshold_tokens), NOW);
}

/// A challenge naming a token the gate does not accept.
pub fn run_wrong_token(threshold_tokens: u128, nonce: felt252) {
    let fixture = setup();
    let other_token = deploy("MockERC20", array![]);
    IMockERC20Dispatcher { contract_address: other_token }
        .mint(recipient: fixture.pool.contract_address, amount: tokens(1000).into());

    let mut params = params_with(fixture, threshold_tokens, nonce);
    params.token = other_token;
    let challenge_id = create(fixture, params);

    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(4));
    cheat_block_timestamp(fixture.gate, NOW, CheatSpan::TargetCalls(2));
    fixture
        .pool
        .clear(
            fixture.limen.contract_address,
            other_token,
            user(),
            USER_PRIVATE_KEY,
            challenge_id,
            tokens(threshold_tokens),
            NOTE_ID,
        );
}

pub fn run_wrong_subject(threshold_tokens: u128, nonce: felt252) {
    let fixture = setup();
    let mut params = params_with(fixture, threshold_tokens, nonce);
    // A subject derived from somebody else's key.
    params.subject = fixture.subject + 1;
    let challenge_id = create(fixture, params);
    drive(fixture, challenge_id, tokens(threshold_tokens), NOW);
}

pub fn run_malformed(nonce: felt252) {
    let fixture = setup();
    // Never created, so nothing backs it.
    drive(fixture, nonce + 0xdead0000, tokens(10), NOW);
}

/// Calling the anonymizer directly rather than through the pool.
pub fn run_direct_call(threshold_tokens: u128, nonce: felt252) {
    let fixture = setup();
    let challenge_id = create(fixture, params_with(fixture, threshold_tokens, nonce));

    // Fund the anonymizer first, so the attempt fails on access control rather than
    // on an empty balance. The point is that the pool path cannot be bypassed even
    // when the capital is genuinely there.
    fixture
        .token
        .mint(recipient: fixture.limen.contract_address, amount: tokens(threshold_tokens).into());

    cheat_caller_address(fixture.limen.contract_address, address(0xbad), CheatSpan::TargetCalls(1));
    fixture.limen.privacy_invoke_with_computation(fixture.subject, challenge_id, 0, NOTE_ID);
}
