use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockERC20<T> {
    fn balance_of(self: @T, account: ContractAddress) -> u256;
    fn allowance(self: @T, owner: ContractAddress, spender: ContractAddress) -> u256;
    fn approve(ref self: T, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: T, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: T, sender: ContractAddress, recipient: ContractAddress, amount: u256,
    ) -> bool;
    fn mint(ref self: T, recipient: ContractAddress, amount: u256);
    /// Lets a test park a balance above `u128::MAX` to exercise the overflow guard.
    fn force_balance(ref self: T, account: ContractAddress, amount: u256);
    /// Makes `approve` return false without reverting, as some non-standard tokens do.
    fn set_approve_returns_false(ref self: T, broken: bool);
}

#[starknet::contract]
pub mod MockERC20 {
    use starknet::storage::{
        Map, StoragePathEntry, StoragePointerReadAccess, StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address};
    use super::IMockERC20;

    #[storage]
    struct Storage {
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        approve_returns_false: bool,
    }

    #[abi(embed_v0)]
    pub impl MockERC20Impl of IMockERC20<ContractState> {
        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        fn allowance(
            self: @ContractState, owner: ContractAddress, spender: ContractAddress,
        ) -> u256 {
            self.allowances.entry((owner, spender)).read()
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            self.allowances.entry((get_caller_address(), spender)).write(amount);
            !self.approve_returns_false.read()
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            let sender_balance = self.balances.entry(sender).read();
            assert(sender_balance >= amount, 'ERC20_INSUFFICIENT_BALANCE');
            self.balances.entry(sender).write(sender_balance - amount);
            self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            let allowance = self.allowances.entry((sender, spender)).read();
            assert(allowance >= amount, 'ERC20_INSUFFICIENT_ALLOWANCE');
            let sender_balance = self.balances.entry(sender).read();
            assert(sender_balance >= amount, 'ERC20_INSUFFICIENT_BALANCE');
            self.allowances.entry((sender, spender)).write(allowance - amount);
            self.balances.entry(sender).write(sender_balance - amount);
            self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
            true
        }

        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.balances.entry(recipient).write(self.balances.entry(recipient).read() + amount);
        }

        fn force_balance(ref self: ContractState, account: ContractAddress, amount: u256) {
            self.balances.entry(account).write(amount);
        }

        fn set_approve_returns_false(ref self: ContractState, broken: bool) {
            self.approve_returns_false.write(broken);
        }
    }
}
