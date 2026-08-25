//! Every falsifiable claim Limen makes, stated as a test that fails if the claim is
//! false. The adversarial campaign in `evidence/campaigns/` replays these same case
//! shapes at scale; this file is the readable version.

use limen_anonymizer::interface::ILimenAnonymizerDispatcherTrait;
use limen_anonymizer::test_contracts::mock_erc20::{
    IMockERC20Dispatcher, IMockERC20DispatcherTrait,
};
use limen_anonymizer::test_contracts::mock_pool::{IMockPoolDispatcherTrait, MockPool};
use limen_capital_gate::interface::{ICapitalGateDispatcher, ICapitalGateDispatcherTrait};
use limen_shared::target::{ILimenTargetDispatcher, ILimenTargetDispatcherTrait, LimenClearance};
use snforge_std::{CheatSpan, EventSpyAssertionsTrait, cheat_block_timestamp, cheat_caller_address};
use super::fixtures::{
    EXPIRES_AT, GATE_MIN, NOTE_ID, NOW, ONE_TOKEN, THRESHOLD, USER_PRIVATE_KEY, address,
    base_params, clear, clear_at, create, deploy, setup, user,
};

/// C1. Below-threshold capital cannot clear a challenge.
#[test]
#[should_panic(expected: 'LIMEN_BELOW_THRESHOLD')]
fn below_threshold_capital_cannot_clear() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    clear_at(fixture, challenge_id, THRESHOLD - 1, NOW);
}

#[test]
#[should_panic(expected: 'LIMEN_BELOW_THRESHOLD')]
fn supplying_no_capital_at_all_cannot_clear() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    clear_at(fixture, challenge_id, 0, NOW);
}

/// The capital condition is exact, so overshooting is a failure too. Accepting a
/// surplus would mean the anonymizer returns capital it cannot account for.
#[test]
#[should_panic(expected: 'LIMEN_ABOVE_THRESHOLD')]
fn above_threshold_capital_cannot_clear() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    clear_at(fixture, challenge_id, THRESHOLD + 1, NOW);
}

/// The disclosed boundary of the capital claim, held to by a test so it can never
/// drift into marketing.
///
/// An ERC-20 balance carries no provenance, so between the proving base and execution
/// a subject can publicly transfer part of the threshold to the anonymizer and let it
/// stand in for private capital. The capital condition still holds in full — the
/// subject really did mobilise the whole threshold, and a subject who cannot raise it
/// at all still cannot clear — but that portion came from public funds rather than
/// from shielded notes.
///
/// This is not silently accepted. The pool publishes the amount it withdrew and to
/// whom, in the same transaction, so the split is on-chain for every clearance:
/// `Withdrawal.amount == threshold` means the whole threshold came from private notes.
/// `scripts/verify-mainnet.ts` asserts it on every published transaction hash, the
/// explorer surfaces it, and `evidence/claims.json` records it as claim C9.
///
/// See DECISIONS.md D-007 for why this cannot be closed inside the contract.
#[test]
fn public_capital_can_substitute_but_the_pool_publishes_the_split() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    let mut spy = snforge_std::spy_events();

    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(4));
    cheat_block_timestamp(fixture.gate, NOW, CheatSpan::TargetCalls(2));
    let compute_result = fixture
        .pool
        .compile(fixture.limen.contract_address, user(), USER_PRIVATE_KEY, challenge_id);

    // The subject tops the anonymizer up publicly after the snapshot was taken, then
    // withdraws only a single unit from private state.
    let public_top_up = THRESHOLD - 1;
    let public_wallet = address(0xa77ac);
    fixture.token.mint(recipient: public_wallet, amount: public_top_up.into());
    cheat_caller_address(fixture.token.contract_address, public_wallet, CheatSpan::TargetCalls(1));
    fixture.token.transfer(recipient: fixture.limen.contract_address, amount: public_top_up.into());

    fixture
        .pool
        .apply(
            fixture.limen.contract_address,
            fixture.token.contract_address,
            1,
            compute_result,
            [NOTE_ID].span(),
        );

    assert_eq!(
        fixture.limen.get_challenge_status(challenge_id).consumed_by,
        fixture.subject,
        "the threshold really was mobilised, so the challenge clears",
    );

    // The pool's own withdrawal record shows only one unit left private state, which is
    // what makes the substitution detectable from the transaction alone.
    spy
        .assert_emitted(
            @array![
                (
                    fixture.pool.contract_address,
                    MockPool::Event::Withdrawal(
                        MockPool::Withdrawal {
                            to_addr: fixture.limen.contract_address,
                            token: fixture.token.contract_address,
                            amount: 1,
                        },
                    ),
                ),
            ],
        );
}

/// The same signal on the honest path: the pool withdrew the whole threshold, so the
/// clearance was funded entirely from shielded notes.
#[test]
fn an_honest_clearance_withdraws_the_whole_threshold_from_the_pool() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    let mut spy = snforge_std::spy_events();

    clear(fixture, challenge_id);

    spy
        .assert_emitted(
            @array![
                (
                    fixture.pool.contract_address,
                    MockPool::Event::Withdrawal(
                        MockPool::Withdrawal {
                            to_addr: fixture.limen.contract_address,
                            token: fixture.token.contract_address,
                            amount: THRESHOLD,
                        },
                    ),
                ),
            ],
        );
}

/// A subject who cannot raise the threshold at all still cannot clear, whatever they
/// do publicly. This is the claim that must never break.
#[test]
#[should_panic(expected: 'LIMEN_BELOW_THRESHOLD')]
fn a_partial_public_top_up_still_leaves_the_subject_short() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));

    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(4));
    let compute_result = fixture
        .pool
        .compile(fixture.limen.contract_address, user(), USER_PRIVATE_KEY, challenge_id);

    let public_wallet = address(0xa77ac);
    fixture.token.mint(recipient: public_wallet, amount: (10 * ONE_TOKEN).into());
    cheat_caller_address(fixture.token.contract_address, public_wallet, CheatSpan::TargetCalls(1));
    fixture
        .token
        .transfer(recipient: fixture.limen.contract_address, amount: (10 * ONE_TOKEN).into());

    fixture
        .pool
        .apply(
            fixture.limen.contract_address,
            fixture.token.contract_address,
            ONE_TOKEN,
            compute_result,
            [NOTE_ID].span(),
        );
}

/// A balance parked in the anonymizer *before* the snapshot is simply part of the
/// baseline: it does not help a spender, and an honest clearance still works.
#[test]
fn a_pre_existing_stray_balance_neither_helps_an_attacker_nor_blocks_an_honest_clearance() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));

    let stranger = address(0x57a1);
    fixture.token.mint(recipient: stranger, amount: (500 * ONE_TOKEN).into());
    cheat_caller_address(fixture.token.contract_address, stranger, CheatSpan::TargetCalls(1));
    fixture
        .token
        .transfer(recipient: fixture.limen.contract_address, amount: (500 * ONE_TOKEN).into());

    clear(fixture, challenge_id);

    assert_eq!(
        fixture.token.balance_of(fixture.limen.contract_address),
        (500 * ONE_TOKEN).into(),
        "the stray balance is untouched: only the measured delta is returned",
    );
}

/// C2. A cleared challenge cannot be cleared again.
#[test]
#[should_panic(expected: 'LIMEN_CHALLENGE_CONSUMED')]
fn a_consumed_challenge_cannot_be_replayed() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    clear(fixture, challenge_id);
    clear(fixture, challenge_id);
}

/// Replay is rejected in the proving leg too, so a replay never reaches mainnet or
/// costs the spender a pool fee.
#[test]
#[should_panic(expected: 'LIMEN_CHALLENGE_CONSUMED')]
fn a_consumed_challenge_is_rejected_before_proving() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    clear(fixture, challenge_id);

    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(1));
    fixture.pool.compile(fixture.limen.contract_address, user(), USER_PRIVATE_KEY, challenge_id);
}

/// C3. Expired challenges fail.
#[test]
#[should_panic(expected: 'LIMEN_CHALLENGE_EXPIRED')]
fn an_expired_challenge_cannot_clear() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    clear_at(fixture, challenge_id, THRESHOLD, EXPIRES_AT + 1);
}

/// C4. Only the bound subject can clear a subject-bound challenge.
#[test]
#[should_panic(expected: 'LIMEN_WRONG_SUBJECT')]
fn another_subject_cannot_clear_a_bound_challenge() {
    let fixture = setup();
    let mut params = base_params(fixture);
    params.subject = 0xd1ffe2;
    let challenge_id = create(fixture, params);
    clear(fixture, challenge_id);
}

#[test]
#[should_panic(expected: 'LIMEN_WRONG_SUBJECT')]
fn a_wrong_subject_is_rejected_before_proving() {
    let fixture = setup();
    let mut params = base_params(fixture);
    params.subject = 0xd1ffe2;
    let challenge_id = create(fixture, params);

    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(1));
    fixture.pool.compile(fixture.limen.contract_address, user(), USER_PRIVATE_KEY, challenge_id);
}

/// The identity key is derived from the spender's private viewing key, so knowing the
/// spender's address is not enough to impersonate them.
#[test]
fn the_subject_changes_with_the_private_key_not_just_the_address() {
    let fixture = setup();
    let with_real_key = fixture
        .pool
        .identity_key_for(user(), USER_PRIVATE_KEY, fixture.limen.contract_address);
    let with_guessed_key = fixture
        .pool
        .identity_key_for(user(), USER_PRIVATE_KEY + 1, fixture.limen.contract_address);
    assert!(with_real_key != with_guessed_key, "a guessed key must not produce the subject");
    assert_eq!(with_real_key, fixture.subject);
}

/// The same user is a different subject at a different anonymizer, so a Limen
/// pseudonym cannot be correlated across deployments.
#[test]
fn the_subject_is_scoped_to_one_anonymizer() {
    let fixture = setup();
    let other_limen = deploy("LimenAnonymizer", array![fixture.pool.contract_address.into()]);
    assert!(
        fixture.pool.identity_key_for(user(), USER_PRIVATE_KEY, other_limen) != fixture.subject,
        "subjects must not be portable between anonymizers",
    );
}

/// C5. Direct calls cannot bypass the pool.
#[test]
#[should_panic(expected: 'LIMEN_CALLER_NOT_POOL')]
fn a_direct_call_cannot_clear_a_challenge() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));

    cheat_caller_address(fixture.limen.contract_address, address(0xbad), CheatSpan::TargetCalls(1));
    fixture
        .limen
        .privacy_invoke_with_computation(fixture.subject, challenge_id, 0, NOTE_ID);
}

/// Even with a correct subject and a truthful snapshot, a non-pool caller is refused
/// before any state is read.
#[test]
#[should_panic(expected: 'LIMEN_CALLER_NOT_POOL')]
fn the_issuer_itself_cannot_clear_its_own_challenge_directly() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    let params = base_params(fixture);

    cheat_caller_address(fixture.limen.contract_address, params.issuer, CheatSpan::TargetCalls(1));
    fixture
        .limen
        .privacy_invoke_with_computation(fixture.subject, challenge_id, 0, NOTE_ID);
}

/// Limen implements no plain `privacy_invoke`, so the pool's non-computing invoke path
/// cannot reach it at all. Without `privacy_compute` there is no proof-bound snapshot,
/// and without a snapshot the capital measurement would be forgeable.
#[test]
#[should_panic]
fn the_plain_invoke_entry_point_does_not_exist() {
    let fixture = setup();
    let challenge_id = create(fixture, base_params(fixture));
    fixture
        .pool
        .plain_invoke(
            fixture.limen.contract_address,
            [fixture.subject, challenge_id, 0, NOTE_ID].span(),
        );
}

/// C6. A challenge cannot be redirected to another target.
#[test]
#[should_panic(expected: 'GATE_CALLER_NOT_LIMEN')]
fn a_target_rejects_a_clearance_that_did_not_come_from_limen() {
    let fixture = setup();
    let clearance = LimenClearance {
        challenge_id: 0x1,
        subject: fixture.subject,
        token: fixture.token.contract_address,
        amount: THRESHOLD,
        action: 'REGISTER_ALLOCATION',
        issuer: address(0x1550e2),
    };
    let target = ILimenTargetDispatcher { contract_address: fixture.gate };
    cheat_caller_address(fixture.gate, address(0xbad), CheatSpan::TargetCalls(1));
    target.limen_execute(clearance);
}

/// C7. A challenge bound to another action does not authorise this one.
#[test]
#[should_panic(expected: 'GATE_UNKNOWN_ACTION')]
fn a_challenge_bound_to_another_action_is_rejected_by_the_target() {
    let fixture = setup();
    let mut params = base_params(fixture);
    params.action = 'DRAIN_TREASURY';
    let challenge_id = create(fixture, params);
    clear(fixture, challenge_id);
}

/// C8. Another token cannot satisfy a token-specific challenge. The gate holds its own
/// token requirement, so even a well-formed clearance in the wrong asset is refused.
#[test]
#[should_panic(expected: 'GATE_WRONG_TOKEN')]
fn capital_in_the_wrong_token_cannot_satisfy_the_gate() {
    let fixture = setup();
    let other_token = deploy("MockERC20", array![]);
    let other = IMockERC20Dispatcher { contract_address: other_token };
    other.mint(recipient: fixture.pool.contract_address, amount: (1_000 * ONE_TOKEN).into());

    let mut params = base_params(fixture);
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
            THRESHOLD,
            NOTE_ID,
        );
}

/// Capital in the wrong token also fails the anonymizer's own measurement, because the
/// snapshot and the delta are both taken on the challenge's token.
#[test]
#[should_panic(expected: 'LIMEN_BELOW_THRESHOLD')]
fn paying_a_different_token_than_the_challenge_names_measures_as_zero() {
    let fixture = setup();
    let other_token = deploy("MockERC20", array![]);
    IMockERC20Dispatcher { contract_address: other_token }
        .mint(recipient: fixture.pool.contract_address, amount: (1_000 * ONE_TOKEN).into());

    let challenge_id = create(fixture, base_params(fixture));
    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(4));
    fixture
        .pool
        .clear(
            fixture.limen.contract_address,
            other_token,
            user(),
            USER_PRIVATE_KEY,
            challenge_id,
            THRESHOLD,
            NOTE_ID,
        );
}

/// C9. A malformed or unknown challenge is rejected.
#[test]
#[should_panic(expected: 'LIMEN_CHALLENGE_NOT_FOUND')]
fn an_unknown_challenge_cannot_clear() {
    let fixture = setup();
    clear(fixture, 0xdeadbeef);
}

#[test]
#[should_panic(expected: 'LIMEN_CHALLENGE_NOT_FOUND')]
fn an_unknown_challenge_is_rejected_before_proving() {
    let fixture = setup();
    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(1));
    fixture.pool.compile(fixture.limen.contract_address, user(), USER_PRIVATE_KEY, 0xdeadbeef);
}

/// C10. A reverting target aborts everything rather than stranding capital.
#[test]
#[should_panic(expected: 'TARGET_REVERTED')]
fn a_reverting_target_aborts_the_whole_transaction() {
    let fixture = setup();
    let reverting = deploy("RevertingTarget", array![]);
    let mut params = base_params(fixture);
    params.target = reverting;
    let challenge_id = create(fixture, params);
    clear(fixture, challenge_id);
}

#[test]
fn no_capital_is_stranded_when_the_target_reverts() {
    let fixture = setup();
    let reverting = deploy("RevertingTarget", array![]);
    let mut params = base_params(fixture);
    params.target = reverting;
    let challenge_id = create(fixture, params);

    let pool_before = fixture.token.balance_of(fixture.pool.contract_address);
    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(4));
    let compute_result = fixture
        .pool
        .compile(fixture.limen.contract_address, user(), USER_PRIVATE_KEY, challenge_id);

    // The pool's `apply` reverts; snforge rolls the whole call back, exactly as the
    // real transaction would.
    let outcome = starknet::syscalls::call_contract_syscall(
        address: fixture.pool.contract_address,
        entry_point_selector: selector!("apply"),
        calldata: build_apply_calldata(
            fixture.limen.contract_address,
            fixture.token.contract_address,
            THRESHOLD,
            compute_result,
        ),
    );
    assert!(outcome.is_err(), "a reverting target must abort the pool transaction");

    assert_eq!(
        fixture.token.balance_of(fixture.pool.contract_address),
        pool_before,
        "the pool keeps its capital",
    );
    assert_eq!(
        fixture.token.balance_of(fixture.limen.contract_address),
        0,
        "no capital is left sitting in the anonymizer",
    );
    assert!(
        fixture.limen.get_challenge_status(challenge_id).consumed_by == 0,
        "a failed clearance must not burn the challenge",
    );
}

fn build_apply_calldata(
    anonymizer: starknet::ContractAddress,
    token: starknet::ContractAddress,
    withdraw_amount: u128,
    compute_result: Span<felt252>,
) -> Span<felt252> {
    let mut calldata: Array<felt252> = array![
        anonymizer.into(), token.into(), withdraw_amount.into(),
    ];
    compute_result.serialize(ref calldata);
    [NOTE_ID].span().serialize(ref calldata);
    calldata.span()
}

/// C11. A target cannot re-enter the anonymizer to clear the same challenge twice.
#[test]
#[should_panic(expected: 'LIMEN_CALLER_NOT_POOL')]
fn a_target_cannot_re_enter_the_anonymizer() {
    let fixture = setup();
    let reentrant = deploy(
        "ReentrantTarget", array![fixture.limen.contract_address.into(), NOTE_ID],
    );
    let mut params = base_params(fixture);
    params.target = reentrant;
    let challenge_id = create(fixture, params);
    clear(fixture, challenge_id);
}

/// C12. A target learns about the capital but never gains control of it.
#[test]
#[should_panic(expected: 'ERC20_INSUFFICIENT_ALLOWANCE')]
fn a_target_cannot_spend_the_capital_it_is_told_about() {
    let fixture = setup();
    let greedy = deploy("GreedyTarget", array![fixture.limen.contract_address.into()]);
    let mut params = base_params(fixture);
    params.target = greedy;
    let challenge_id = create(fixture, params);
    clear(fixture, challenge_id);
}

/// C13. One challenge's capital cannot be credited against another challenge.
#[test]
#[should_panic(expected: 'LIMEN_ABOVE_THRESHOLD')]
fn capital_proven_for_one_challenge_cannot_clear_another() {
    let fixture = setup();
    let cheap = {
        let mut params = base_params(fixture);
        params.threshold = ONE_TOKEN;
        params.nonce = 0x10;
        create(fixture, params)
    };
    let expensive = create(fixture, base_params(fixture));

    cheat_block_timestamp(fixture.limen.contract_address, NOW, CheatSpan::TargetCalls(4));
    let compute_result = fixture
        .pool
        .compile(fixture.limen.contract_address, user(), USER_PRIVATE_KEY, cheap);
    let _ = expensive;

    // Withdraw the expensive threshold while presenting the cheap challenge's proof.
    fixture
        .pool
        .apply(
            fixture.limen.contract_address,
            fixture.token.contract_address,
            THRESHOLD,
            compute_result,
            [NOTE_ID].span(),
        );
}

/// C14. The gate enforces its own minimum, so a verifier cannot lower the bar by
/// issuing a cheaper challenge against someone else's application.
#[test]
#[should_panic(expected: 'GATE_AMOUNT_TOO_LOW')]
fn a_cheap_challenge_cannot_lower_the_targets_own_requirement() {
    let fixture = setup();
    let mut params = base_params(fixture);
    params.threshold = GATE_MIN - 1;
    params.nonce = 0x20;
    let challenge_id = create(fixture, params);
    clear_at(fixture, challenge_id, GATE_MIN - 1, NOW);
}

/// C15. There is no privileged path. The contract has no owner, no admin entry points,
/// and no way to record a clearance without the pool-mediated capital flow.
#[test]
fn the_anonymizer_exposes_no_privileged_entry_points() {
    let fixture = setup();
    // The pool binding is fixed at deployment and there is no setter to change it.
    assert_eq!(fixture.limen.get_pool(), fixture.pool.contract_address);

    let challenge_id = create(fixture, base_params(fixture));
    // A challenge exists but grants nothing until capital moves.
    assert_eq!(fixture.limen.get_challenge_status(challenge_id).consumed_by, 0);
    assert!(
        !ICapitalGateDispatcher { contract_address: fixture.gate }.is_qualified(fixture.subject),
        "creating a challenge must not qualify anyone",
    );
}
