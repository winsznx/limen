use limen_shared::challenge::{CHALLENGE_TAG, ChallengeParams, compute_challenge_id};
use starknet::ContractAddress;

fn address(value: felt252) -> ContractAddress {
    value.try_into().unwrap()
}

fn sample_params() -> ChallengeParams {
    ChallengeParams {
        token: address(0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d),
        threshold: 50_000_000_000_000_000_000,
        target: address(0x111),
        action: 'REGISTER_ALLOCATION',
        subject: 0x222,
        issuer: address(0x333),
        expires_at: 1_800_000_000,
        nonce: 0x444,
    }
}

const SN_MAIN: felt252 = 0x534e5f4d41494e;
const LIMEN: felt252 = 0x555;

/// Pinned vector. The TypeScript SDK derives challenge identifiers independently, and
/// `packages/limen-sdk` asserts the same value. Comparing the contract against itself
/// would prove nothing, so this constant is the shared oracle: if either side changes
/// its derivation, exactly one of the two suites goes red.
#[test]
fn challenge_id_matches_the_pinned_cross_language_vector() {
    let id = compute_challenge_id(SN_MAIN, address(LIMEN), sample_params());
    assert_eq!(id, 0x54c49fe6048cb8e3671aab2429f12bc0b4e6da77641c01cc060b94af21113fb);
}

#[test]
fn challenge_id_is_bound_to_the_chain() {
    let sepolia = 0x534e5f5345504f4c4941;
    assert!(
        compute_challenge_id(
            SN_MAIN, address(LIMEN), sample_params(),
        ) != compute_challenge_id(sepolia, address(LIMEN), sample_params()),
        "a challenge issued for one chain must not be presentable on another",
    );
}

#[test]
fn challenge_id_is_bound_to_the_limen_deployment() {
    assert!(
        compute_challenge_id(
            SN_MAIN, address(LIMEN), sample_params(),
        ) != compute_challenge_id(SN_MAIN, address(LIMEN + 1), sample_params()),
        "a challenge issued for one Limen deployment must not be presentable to another",
    );
}

#[test]
fn every_challenge_field_changes_the_identifier() {
    let base = compute_challenge_id(SN_MAIN, address(LIMEN), sample_params());

    let mut mutated = sample_params();
    mutated.token = address(0x999);
    assert!(compute_challenge_id(SN_MAIN, address(LIMEN), mutated) != base, "token");

    let mut mutated = sample_params();
    mutated.threshold += 1;
    assert!(compute_challenge_id(SN_MAIN, address(LIMEN), mutated) != base, "threshold");

    let mut mutated = sample_params();
    mutated.target = address(0x999);
    assert!(compute_challenge_id(SN_MAIN, address(LIMEN), mutated) != base, "target");

    let mut mutated = sample_params();
    mutated.action = 'OTHER_ACTION';
    assert!(compute_challenge_id(SN_MAIN, address(LIMEN), mutated) != base, "action");

    let mut mutated = sample_params();
    mutated.subject += 1;
    assert!(compute_challenge_id(SN_MAIN, address(LIMEN), mutated) != base, "subject");

    let mut mutated = sample_params();
    mutated.issuer = address(0x999);
    assert!(compute_challenge_id(SN_MAIN, address(LIMEN), mutated) != base, "issuer");

    let mut mutated = sample_params();
    mutated.expires_at += 1;
    assert!(compute_challenge_id(SN_MAIN, address(LIMEN), mutated) != base, "expires_at");

    let mut mutated = sample_params();
    mutated.nonce += 1;
    assert!(compute_challenge_id(SN_MAIN, address(LIMEN), mutated) != base, "nonce");
}

#[test]
fn tag_is_the_declared_domain_separator() {
    assert_eq!(CHALLENGE_TAG, 'LIMEN_CHALLENGE:V1');
}
