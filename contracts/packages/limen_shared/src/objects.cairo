use starknet::ContractAddress;

/// Mirrors `privacy::objects::OpenNoteDeposit` in the STRK20 pool class deployed at
/// `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
/// (class `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`).
///
/// The pool deserializes an anonymizer's return value directly into its own copy of
/// this struct, so field order and widths are part of the wire format. Serialization
/// is pinned by `limen_shared::tests::test_objects`.
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    /// Identifier of the open note the pool should credit.
    pub note_id: felt252,
    /// ERC-20 the pool pulls from the anonymizer.
    pub token: ContractAddress,
    /// Amount the pool pulls and credits, in token base units.
    pub amount: u128,
}

/// Minimal ERC-20 surface the anonymizer needs. Declared locally so the contract does
/// not inherit a token library's dual-case dispatch behaviour: every token Limen
/// supports must expose the snake_case entry points the STRK20 pool itself calls.
#[starknet::interface]
pub trait IERC20<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
}
