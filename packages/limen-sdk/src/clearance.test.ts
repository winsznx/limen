import { describe, expect, it } from "vitest";
import { buildClearancePlan, selectNotes } from "./clearance.js";
import { LimenError } from "./errors.js";
import type { Challenge } from "./challenge.js";

const NOW = 1_700_000_000;

const CHALLENGE: Challenge = {
  challengeId: "0xc1",
  token: "0x70ce4",
  threshold: 50n,
  target: "0x7a26e7",
  action: "REGISTER_ALLOCATION",
  subject: "0x5b1",
  issuer: "0x1550e2",
  expiresAt: NOW + 600,
  consumedBy: null,
  consumedAt: null,
  open: true,
};

const OPTIONS = {
  challenge: CHALLENGE,
  subject: "0x5b1",
  anonymizer: "0x11e3",
  noteRecipient: "0x5e2",
  provingBlockId: 1_000,
  poolFee: 6_000_000_000_000_000_000n,
  tokenSymbol: "STRK",
  now: NOW,
};

describe("clearance planning", () => {
  it("withdraws exactly the threshold", () => {
    expect(buildClearancePlan(OPTIONS).withdrawAmount).toBe(50n);
  });

  it("rejects a consumed challenge before anything is signed", () => {
    expect(() =>
      buildClearancePlan({
        ...OPTIONS,
        challenge: { ...CHALLENGE, consumedBy: "0x5b1", open: false },
      })
    ).toThrow(LimenError);
  });

  it("rejects an expired challenge at signing time, not at fetch time", () => {
    // The challenge was open when it was read; proving took long enough that it is not
    // any more. Submitting would burn a pool fee for a guaranteed revert.
    expect(() => buildClearancePlan({ ...OPTIONS, now: CHALLENGE.expiresAt + 1 })).toThrow(
      /expired/i
    );
  });

  it("rejects a subject the challenge is not bound to", () => {
    expect(() => buildClearancePlan({ ...OPTIONS, subject: "0xd1ff" })).toThrow(/different Limen subject/);
  });

  it("lets any subject clear a bearer challenge", () => {
    const plan = buildClearancePlan({
      ...OPTIONS,
      challenge: { ...CHALLENGE, subject: "0x0" },
      subject: "0xanyone".replace("anyone", "a11"),
    });
    expect(plan.withdrawAmount).toBe(50n);
  });

  it("states the privacy boundary concretely rather than in general terms", () => {
    const { disclosure } = buildClearancePlan(OPTIONS);
    expect(disclosure.becomesPublic.join(" ")).toContain("50 base units");
    expect(disclosure.staysPrivate.join(" ")).toContain("total shielded balance");
    expect(disclosure.caveats.join(" ")).toContain("not proof of solvency");
  });
});

describe("note selection", () => {
  const mature = (amount: bigint) => ({ amount, created: 0 });

  it("covers the threshold with the fewest notes", () => {
    const selected = selectNotes([mature(10n), mature(40n), mature(5n)], 45n, 100);
    expect(selected.map((note) => note.amount)).toEqual([40n, 10n]);
  });

  it("reports immature notes distinctly from an actual shortfall", () => {
    const notes = [{ amount: 100n, created: 95 }];
    expect(() => selectNotes(notes, 50n, 100)).toThrow(/too new to spend/);
  });

  it("reports a real shortfall as a shortfall", () => {
    expect(() => selectNotes([mature(10n)], 50n, 100)).toThrow(/do not cover the threshold/);
  });

  it("treats a note exactly at the maturity boundary as spendable", () => {
    expect(selectNotes([{ amount: 50n, created: 90 }], 50n, 100)).toHaveLength(1);
  });
});
