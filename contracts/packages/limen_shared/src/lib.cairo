//! Types shared between the Limen Anonymizer, Limen target applications, and the
//! off-chain Limen SDK.
//!
//! Everything the STRK20 pool deserializes is mirrored here from the class actually
//! deployed at the mainnet pool, not from the monorepo `main` branch, which is ahead
//! of mainnet. See `evidence/mainnet/pool-abi.json` for the pinned ABI.

pub mod challenge;
pub mod errors;
pub mod objects;
pub mod target;

#[cfg(test)]
mod tests;
