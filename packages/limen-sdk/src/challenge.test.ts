import { describe, expect, it } from "vitest";
import { computeChallengeId, randomNonce, type ChallengeParams } from "./challenge.js";
import { deriveSubject, formatSubject } from "./subject.js";

const SN_MAIN = "0x534e5f4d41494e";
const LIMEN = "0x555";

const SAMPLE: ChallengeParams = {
  token: "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  threshold: 50_000_000_000_000_000_000n,
  target: "0x111",
  action: "REGISTER_ALLOCATION",
  subject: "0x222",
  issuer: "0x333",
  expiresAt: 1_800_000_000,
  nonce: "0x444",
};

describe("challenge id derivation", () => {
  /**
   * The shared oracle with Cairo. `limen_shared::tests::test_challenge` asserts this
   * same constant, so a change to either implementation turns exactly one suite red
   * rather than both agreeing on something new.
   */
  it("matches the pinned cross-language vector", () => {
    expect(computeChallengeId(SN_MAIN, LIMEN, SAMPLE)).toBe(
      "0x54c49fe6048cb8e3671aab2429f12bc0b4e6da77641c01cc060b94af21113fb"
    );
  });

  it("is bound to the chain", () => {
    const sepolia = "0x534e5f5345504f4c4941";
    expect(computeChallengeId(sepolia, LIMEN, SAMPLE)).not.toBe(
      computeChallengeId(SN_MAIN, LIMEN, SAMPLE)
    );
  });

  it("is bound to the Limen deployment", () => {
    expect(computeChallengeId(SN_MAIN, "0x556", SAMPLE)).not.toBe(
      computeChallengeId(SN_MAIN, LIMEN, SAMPLE)
    );
  });

  it("changes with every field", () => {
    const base = computeChallengeId(SN_MAIN, LIMEN, SAMPLE);
    const mutations: Array<Partial<ChallengeParams>> = [
      { token: "0x999" },
      { threshold: SAMPLE.threshold + 1n },
      { target: "0x999" },
      { action: "OTHER_ACTION" },
      { subject: "0x223" },
      { issuer: "0x999" },
      { expiresAt: SAMPLE.expiresAt + 1 },
      { nonce: "0x445" },
    ];
    for (const mutation of mutations) {
      expect(computeChallengeId(SN_MAIN, LIMEN, { ...SAMPLE, ...mutation })).not.toBe(base);
    }
  });

  it("accepts an action given as a felt or as a short string", () => {
    const asShortString = computeChallengeId(SN_MAIN, LIMEN, SAMPLE);
    const asFelt = computeChallengeId(SN_MAIN, LIMEN, {
      ...SAMPLE,
      action: "0x52454749535445525f414c4c4f434154494f4e",
    });
    expect(asFelt).toBe(asShortString);
  });
});

describe("nonces", () => {
  it("are unique and non-zero across a large sample", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 2_000; index += 1) {
      const nonce = randomNonce();
      expect(BigInt(nonce)).toBeGreaterThan(0n);
      expect(seen.has(nonce)).toBe(false);
      seen.add(nonce);
    }
  });
});

describe("subject derivation", () => {
  const user = "0x5e2";
  const limen = "0x11e3";
  const key = 0x5ec2e7n;

  it("is stable for the same user, key and anonymizer", () => {
    expect(deriveSubject(user, key, limen)).toBe(deriveSubject(user, key, limen));
  });

  it("changes with the private key, so an address alone cannot impersonate", () => {
    expect(deriveSubject(user, key + 1n, limen)).not.toBe(deriveSubject(user, key, limen));
  });

  it("is scoped to one anonymizer, so pseudonyms do not correlate across deployments", () => {
    expect(deriveSubject(user, key, "0x11e4")).not.toBe(deriveSubject(user, key, limen));
  });

  it("rejects a viewing key that was passed as a hex string rather than a bigint", () => {
    // The SDK silently derives the wrong channel keys in this case, so it is caught
    // at the boundary instead.
    expect(() => deriveSubject(user, BigInt(0), limen)).toThrow(/positive bigint/);
  });

  it("abbreviates for display without exposing the full pseudonym", () => {
    const formatted = formatSubject(deriveSubject(user, key, limen));
    expect(formatted).toMatch(/^limen:[0-9a-f]{6}…[0-9a-f]{4}$/);
  });
});
