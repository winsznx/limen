use starknet::ContractAddress;

/// The action identifier this gate accepts. A challenge bound to any other action is
/// rejected even if every other field matches.
pub const ACTION_REGISTER_ALLOCATION: felt252 = 'REGISTER_ALLOCATION';

/// What the gate records when a subject qualifies. There is no address here: the gate
/// never learns who the subject is, only that they cleared the capital condition.
#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Allocation {
    pub subject: felt252,
    pub token: ContractAddress,
    pub amount: u128,
    pub registered_at: u64,
}

#[starknet::interface]
pub trait ICapitalGate<T> {
    /// The allocation recorded for a cleared challenge. Zeroed if the challenge never
    /// cleared against this gate.
    fn get_allocation(self: @T, challenge_id: felt252) -> Allocation;

    /// How many allocations this subject has registered.
    fn get_subject_allocation_count(self: @T, subject: felt252) -> u32;

    /// Whether the subject has registered at least one allocation.
    fn is_qualified(self: @T, subject: felt252) -> bool;

    fn get_allocation_count(self: @T) -> u64;

    /// Minimum amount the gate accepts, independent of what a challenge asked for.
    /// A verifier cannot lower the gate's own bar by issuing a cheaper challenge.
    fn get_min_amount(self: @T) -> u128;

    /// Token the gate accepts capital in.
    fn get_required_token(self: @T) -> ContractAddress;

    /// The Limen Anonymizer this gate trusts. Immutable.
    fn get_limen(self: @T) -> ContractAddress;
}
