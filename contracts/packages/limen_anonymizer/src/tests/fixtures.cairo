use limen_anonymizer::interface::{ILimenAnonymizerDispatcher, ILimenAnonymizerDispatcherTrait};
use limen_anonymizer::test_contracts::mock_erc20::{IMockERC20Dispatcher, IMockERC20DispatcherTrait};
use limen_anonymizer::test_contracts::mock_pool::{IMockPoolDispatcher, IMockPoolDispatcherTrait};
use limen_shared::challenge::ChallengeParams;
use snforge_std::{
    CheatSpan, ContractClassTrait, DeclareResultTrait, cheat_block_timestamp, cheat_caller_address,
    declare,
};
use starknet::ContractAddress;

pub const ONE_TOKEN: u128 = 1_000_000_000_000_000_000;
pub const THRESHOLD: u128 = 50 * ONE_TOKEN;
pub const GATE_MIN: u128 = 10 * ONE_TOKEN;
pub const NOW: u64 = 1_700_000_000;
pub const EXPIRES_AT: u64 = NOW + 3600;
pub const NOTE_ID: felt252 = 0x0731;
pub const ACTION: felt252 = 'REGISTER_ALLOCATION';

pub fn address(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

pub fn user() -> ContractAddress {
    address(0x5e2)
}

pub const USER_PRIVATE_KEY: felt252 = 0x5ec2e7;

pub fn issuer() -> ContractAddress {
    address(0x1550e2)
}

#[derive(Copy, Drop)]
pub struct Fixture {
    pub pool: IMockPoolDispatcher,
    pub limen: ILimenAnonymizerDispatcher,
    pub token: IMockERC20Dispatcher,
    pub gate: ContractAddress,
    pub subject: felt252,
}

pub fn deploy(name: ByteArray, calldata: Array<felt252>) -> ContractAddress {
    let contract = declare(name).unwrap().contract_class();
    let (deployed, _) = contract.deploy(@calldata).unwrap();
    deployed
}

/// Deploys the pool stand-in, the anonymizer bound to it, a token, and the reference
/// gate. The pool is funded so it can play the withdrawal leg.
pub fn setup() -> Fixture {
    let pool_address = deploy("MockPool", array![]);
    let limen_address = deploy("LimenAnonymizer", array![pool_address.into()]);
    let token_address = deploy("MockERC20", array![]);
    let gate_address = deploy(
        "CapitalGate", array![limen_address.into(), token_address.into(), GATE_MIN.into()],
    );

    let token = IMockERC20Dispatcher { contract_address: token_address };
    token.mint(recipient: pool_address, amount: (1_000 * ONE_TOKEN).into());

    let pool = IMockPoolDispatcher { contract_address: pool_address };
    Fixture {
        pool,
        limen: ILimenAnonymizerDispatcher { contract_address: limen_address },
        token,
        gate: gate_address,
        subject: pool.identity_key_for(user(), USER_PRIVATE_KEY, limen_address),
    }
}

pub fn base_params(fixture: Fixture) -> ChallengeParams {
    ChallengeParams {
        token: fixture.token.contract_address,
        threshold: THRESHOLD,
        target: fixture.gate,
        action: ACTION,
        subject: fixture.subject,
        issuer: issuer(),
        expires_at: EXPIRES_AT,
        nonce: 0x1,
    }
}

/// Creates a challenge as `issuer` at the fixed test timestamp.
pub fn create(fixture: Fixture, params: ChallengeParams) -> felt252 {
    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(1));
    cheat_caller_address(fixture.limen.contract_address, params.issuer, CheatSpan::TargetCalls(1));
    fixture.limen.create_challenge(params)
}

/// Runs the whole pool sandwich at `timestamp`: compute, withdraw, invoke, pull.
pub fn clear_at(fixture: Fixture, challenge_id: felt252, withdraw_amount: u128, timestamp: u64) {
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
            withdraw_amount,
            NOTE_ID,
        );
}

pub fn clear(fixture: Fixture, challenge_id: felt252) {
    clear_at(fixture, challenge_id, THRESHOLD, NOW);
}
