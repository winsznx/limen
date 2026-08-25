use limen_shared::objects::OpenNoteDeposit;
use starknet::ContractAddress;

/// The STRK20 pool deserializes an anonymizer's return value straight into its own
/// `OpenNoteDeposit`, so the wire format is a protocol contract, not an internal
/// detail. Three felts, in this order.
#[test]
fn open_note_deposit_serializes_to_three_felts_in_pool_order() {
    let token: ContractAddress = 0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7
        .try_into()
        .unwrap();
    let deposit = OpenNoteDeposit { note_id: 0xabc, token, amount: 1_000_000_000_000_000_000 };

    let mut serialized: Array<felt252> = array![];
    deposit.serialize(ref serialized);

    assert_eq!(serialized.len(), 3);
    assert_eq!(*serialized[0], 0xabc);
    assert_eq!(*serialized[1], token.into());
    assert_eq!(*serialized[2], 1_000_000_000_000_000_000);
}

#[test]
fn open_note_deposit_span_round_trips() {
    let token: ContractAddress = 0x123.try_into().unwrap();
    let original = [OpenNoteDeposit { note_id: 7, token, amount: 42 }].span();

    let mut serialized: Array<felt252> = array![];
    original.serialize(ref serialized);
    // A span serializes as length followed by elements: 1 + 3 felts.
    assert_eq!(serialized.len(), 4);
    assert_eq!(*serialized[0], 1);

    let mut cursor = serialized.span();
    let decoded: Span<OpenNoteDeposit> = Serde::deserialize(ref cursor).unwrap();
    assert!(cursor.is_empty(), "pool rejects trailing data after the deposits");
    assert_eq!(decoded.len(), 1);
    assert_eq!(*decoded[0], *original[0]);
}
