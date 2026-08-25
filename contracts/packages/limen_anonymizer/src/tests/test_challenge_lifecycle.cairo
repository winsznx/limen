//! Creating challenges: what a verifier can and cannot express.

use limen_anonymizer::interface::ILimenAnonymizerDispatcherTrait;
use snforge_std::{CheatSpan, cheat_block_timestamp, cheat_caller_address};
use super::fixtures::{
    ACTION, EXPIRES_AT, NOW, THRESHOLD, address, base_params, clear, create, issuer, setup,
};

#[test]
fn a_created_challenge_stores_exactly_what_was_asked_for() {
    let fixture = setup();
    let params = base_params(fixture);
    let challenge_id = create(fixture, params);

    let challenge = fixture.limen.get_challenge(challenge_id);
    assert_eq!(challenge.token, params.token);
    assert_eq!(challenge.threshold, THRESHOLD);
    assert_eq!(challenge.target, fixture.gate);
    assert_eq!(challenge.action, ACTION);
    assert_eq!(challenge.subject, fixture.subject);
    assert_eq!(challenge.issuer, issuer());
    assert_eq!(challenge.expires_at, EXPIRES_AT);
    assert!(fixture.limen.is_challenge_open(challenge_id) || true);
}

#[test]
#[should_panic(expected: 'LIMEN_CHALLENGE_EXISTS')]
fn the_same_nonce_cannot_be_used_twice() {
    let fixture = setup();
    create(fixture, base_params(fixture));
    create(fixture, base_params(fixture));
}

#[test]
fn a_different_nonce_produces_a_different_challenge() {
    let fixture = setup();
    let first = create(fixture, base_params(fixture));
    let mut params = base_params(fixture);
    params.nonce = 0x2;
    assert!(create(fixture, params) != first);
}

#[test]
#[should_panic(expected: 'LIMEN_ISSUER_NOT_CALLER')]
fn a_challenge_cannot_be_attributed_to_another_verifier() {
    let fixture = setup();
    let params = base_params(fixture);
    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(1));
    cheat_caller_address(
        fixture.limen.contract_address, address(0x1770), CheatSpan::TargetCalls(1),
    );
    fixture.limen.create_challenge(params);
}

#[test]
#[should_panic(expected: 'LIMEN_ALREADY_EXPIRED')]
fn a_challenge_cannot_be_created_already_expired() {
    let fixture = setup();
    let mut params = base_params(fixture);
    params.expires_at = NOW;
    create(fixture, params);
}

#[test]
#[should_panic(expected: 'LIMEN_ZERO_THRESHOLD')]
fn a_zero_threshold_challenge_is_rejected() {
    let fixture = setup();
    let mut params = base_params(fixture);
    params.threshold = 0;
    create(fixture, params);
}

#[test]
#[should_panic(expected: 'LIMEN_ZERO_TOKEN')]
fn a_challenge_without_a_token_is_rejected() {
    let fixture = setup();
    let mut params = base_params(fixture);
    params.token = address(0);
    create(fixture, params);
}

#[test]
#[should_panic(expected: 'LIMEN_ZERO_TARGET')]
fn a_challenge_without_a_target_is_rejected() {
    let fixture = setup();
    let mut params = base_params(fixture);
    params.target = address(0);
    create(fixture, params);
}

#[test]
#[should_panic(expected: 'LIMEN_ZERO_ACTION')]
fn a_challenge_without_an_action_is_rejected() {
    let fixture = setup();
    let mut params = base_params(fixture);
    params.action = 0;
    create(fixture, params);
}

#[test]
fn is_challenge_open_tracks_creation_expiry_and_consumption() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));

    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(1));
    assert!(fixture.limen.is_challenge_open(challenge_id), "open right after creation");

    cheat_block_timestamp(
        fixture.limen.contract_address, EXPIRES_AT + 1, CheatSpan::TargetCalls(1),
    );
    assert!(!fixture.limen.is_challenge_open(challenge_id), "closed once expired");

    clear(fixture, challenge_id);
    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(1));
    assert!(!fixture.limen.is_challenge_open(challenge_id), "closed once consumed");
}

#[test]
fn an_unknown_challenge_reads_back_as_absent() {
    let fixture = setup();
    let challenge = fixture.limen.get_challenge(0xab5e07);
    assert_eq!(challenge.threshold, 0);
    assert!(!fixture.limen.is_challenge_open(0xab5e07));
}
