use starknet::ContractAddress;

/// What the Limen Anonymizer hands a target application when a challenge clears.
///
/// It is a statement about capital, not about identity: the target learns that
/// `subject` mobilised `amount` of `token` through the STRK20 pool inside this
/// transaction, and nothing about the subject's total shielded balance, its other
/// notes, or its Starknet address.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct LimenClearance {
    /// The challenge that cleared. Unique, and consumed exactly once.
    pub challenge_id: felt252,
    /// Limen subject identifier, derived by the pool from the spender's private
    /// viewing key and the anonymizer address. Stable per (user, anonymizer),
    /// unlinkable across anonymizers, and unforgeable without the private key.
    pub subject: felt252,
    /// Token whose capital satisfied the challenge.
    pub token: ContractAddress,
    /// Amount that reached the anonymizer, measured on-chain. Equals the challenge
    /// threshold.
    pub amount: u128,
    /// Application-defined action identifier bound in the challenge.
    pub action: felt252,
    /// Address that issued the challenge.
    pub issuer: ContractAddress,
}

/// The single entry point Limen calls on a target application.
///
/// Limen deliberately does not accept a caller-supplied selector. A challenge can only
/// ever cause `limen_execute` to run on its bound target, so the anonymizer can never
/// be used as a general-purpose call proxy for the capital it is holding.
#[starknet::interface]
pub trait ILimenTarget<T> {
    fn limen_execute(ref self: T, clearance: LimenClearance);
}
