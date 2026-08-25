import { describe, expect, it } from "vitest";
import { formatAmount, parseAmount, findToken, STRK_MAINNET, USDC_MAINNET } from "./tokens.js";
import { MAINNET, networkForChainId } from "./networks.js";

/**
 * Amount handling is where a privacy product quietly loses money. A threshold that is
 * off by one base unit fails the anonymizer's exact-equality check and burns a pool
 * fee, so parsing has to be exact at 18 decimals, which `Number` cannot represent.
 */
describe("amount parsing", () => {
  it("parses 18-decimal amounts exactly, where a float would not", () => {
    expect(parseAmount("50", 18)).toBe(50_000_000_000_000_000_000n);
    expect(parseAmount("0.1", 18)).toBe(100_000_000_000_000_000n);
    // 0.1 + 0.2 in floating point is 0.30000000000000004.
    expect(parseAmount("0.1", 18) + parseAmount("0.2", 18)).toBe(parseAmount("0.3", 18));
  });

  it("keeps precision a float would drop", () => {
    expect(parseAmount("1234567.890123456789", 18)).toBe(1_234_567_890_123_456_789_000_000n);
  });

  it("handles a 6-decimal token", () => {
    expect(parseAmount("1.5", 6)).toBe(1_500_000n);
  });

  it("refuses more decimal places than the token has", () => {
    expect(() => parseAmount("1.1234567", 6)).toThrow(/more than 6 decimal places/);
  });

  it("refuses anything that is not a plain decimal", () => {
    for (const bad of ["1e18", "-1", "1.2.3", "", " ", "0x10", "1,000"]) {
      expect(() => parseAmount(bad, 18)).toThrow();
    }
  });

  it("round-trips through formatting", () => {
    for (const value of ["50", "0.000000000000000001", "1234567.890123456789", "0"]) {
      expect(formatAmount(parseAmount(value, 18), 18)).toBe(value === "0" ? "0" : value);
    }
  });

  it("formats without a trailing dot when the fraction is empty", () => {
    expect(formatAmount(50_000_000_000_000_000_000n, 18)).toBe("50");
    expect(formatAmount(0n, 18)).toBe("0");
  });
});

describe("token and network lookup", () => {
  it("finds a token whether or not the address is zero-padded", () => {
    expect(findToken("mainnet", STRK_MAINNET.address)?.symbol).toBe("STRK");
    expect(findToken("mainnet", STRK_MAINNET.address.replace("0x0", "0x"))?.symbol).toBe("STRK");
  });

  it("returns nothing for an unknown token rather than guessing", () => {
    expect(findToken("mainnet", "0xdead")).toBeUndefined();
  });

  it("knows USDC has 6 decimals, not 18", () => {
    expect(USDC_MAINNET.decimals).toBe(6);
  });

  it("resolves the mainnet chain id back to mainnet", () => {
    expect(networkForChainId(MAINNET.chainId)?.network).toBe("mainnet");
    expect(networkForChainId("0x534e5f4d41494e")?.poolAddress).toBe(MAINNET.poolAddress);
  });

  it("does not resolve an unknown chain", () => {
    expect(networkForChainId("0x1")).toBeUndefined();
  });
});
