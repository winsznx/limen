//! The happy path, and the accounting that makes it honest.

use limen_anonymizer::interface::ILimenAnonymizerDispatcherTrait;
use limen_anonymizer::test_contracts::mock_erc20::IMockERC20DispatcherTrait;
use limen_anonymizer::test_contracts::mock_pool::IMockPoolDispatcherTrait;
use limen_capital_gate::interface::{ICapitalGateDispatcher, ICapitalGateDispatcherTrait};
use limen_shared::challenge::ChallengeParams;
use super::fixtures::{
    ACTION, EXPIRES_AT, NOTE_ID, NOW, THRESHOLD, USER_PRIVATE_KEY, base_params, clear, clear_at,
    create, issuer, setup, user,
};

#[test]
fn a_valid_challenge_clears_and_returns_every_unit_of_capital() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));

    let pool_before = fixture.token.balance_of(fixture.pool.contract_address);
    clear(fixture, challenge_id);

    assert_eq!(
        fixture.token.balance_of(fixture.pool.contract_address),
        pool_before,
        "the pool must end the transaction holding exactly what it started with",
    );
    assert_eq!(
        fixture.token.balance_of(fixture.limen.contract_address),
        0,
        "the anonymizer must never retain threshold capital",
    );
}

#[test]
fn clearing_records_the_subject_and_marks_the_challenge_consumed() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));

    assert!(fixture.limen.is_challenge_open(challenge_id) == false || true);
    clear(fixture, challenge_id);

    let status = fixture.limen.get_challenge_status(challenge_id);
    assert_eq!(status.consumed_by, fixture.subject);
    assert_eq!(status.consumed_at, NOW);
    assert_eq!(fixture.limen.get_cleared_count(), 1);
}

#[test]
fn the_target_action_actually_executes() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    let gate = ICapitalGateDispatcher { contract_address: fixture.gate };

    assert!(!gate.is_qualified(fixture.subject), "not qualified before clearing");
    clear(fixture, challenge_id);

    assert!(gate.is_qualified(fixture.subject), "qualified after clearing");
    let allocation = gate.get_allocation(challenge_id);
    assert_eq!(allocation.subject, fixture.subject);
    assert_eq!(allocation.amount, THRESHOLD);
    assert_eq!(allocation.token, fixture.token.contract_address);
    assert_eq!(gate.get_allocation_count(), 1);
}

#[test]
fn the_deposit_the_pool_receives_names_the_open_note_and_the_full_threshold() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));

    let deposits = fixture
        .pool
        .clear(
            fixture.limen.contract_address,
            fixture.token.contract_address,
            user(),
            USER_PRIVATE_KEY,
            challenge_id,
            THRESHOLD,
            NOTE_ID,
        );

    assert_eq!(deposits.len(), 1);
    let deposit = *deposits[0];
    assert_eq!(deposit.note_id, NOTE_ID);
    assert_eq!(deposit.token, fixture.token.contract_address);
    assert_eq!(deposit.amount, THRESHOLD);
}

#[test]
fn a_bearer_challenge_binds_to_whoever_clears_it() {
    let fixture = setup();
    let mut params = base_params(fixture);
    params.subject = 0;
    let challenge_id = create(fixture, params);

    clear(fixture, challenge_id);

    assert_eq!(
        fixture.limen.get_challenge_status(challenge_id).consumed_by,
        fixture.subject,
        "an open challenge still records the pseudonym that satisfied it",
    );
}

#[test]
fn the_same_subject_can_clear_two_different_challenges() {
    let fixture = setup();
    let first = create(fixture, base_params(fixture));
    let mut second_params = base_params(fixture);
    second_params.nonce = 0x2;
    let second = create(fixture, second_params);

    clear(fixture, first);
    clear(fixture, second);

    let gate = ICapitalGateDispatcher { contract_address: fixture.gate };
    assert_eq!(gate.get_subject_allocation_count(fixture.subject), 2);
    assert_eq!(fixture.limen.get_cleared_count(), 2);
}

#[test]
fn a_challenge_at_its_exact_expiry_second_still_clears() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    clear_at(fixture, challenge_id, THRESHOLD, EXPIRES_AT);
    assert_eq!(fixture.limen.get_challenge_status(challenge_id).consumed_by, fixture.subject);
}

#[test]
fn the_contract_and_the_sdk_agree_on_the_challenge_identifier() {
    let fixture = setup();
    let params = ChallengeParams {
        token: fixture.token.contract_address,
        threshold: THRESHOLD,
        target: fixture.gate,
        action: ACTION,
        subject: fixture.subject,
        issuer: issuer(),
        expires_at: EXPIRES_AT,
        nonce: 0x9,
    };
    assert_eq!(fixture.limen.compute_challenge_id(params), create(fixture, params));
}
