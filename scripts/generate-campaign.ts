/**
 * Generates the deterministic 100-case adversarial campaign.
 *
 * Each case becomes one independent Cairo test, so the pass/fail oracle is snforge's
 * own reporting rather than a summary the campaign writes about itself. A test that
 * expects a rejection is a `should_panic` on the exact error selector, so a case that
 * fails for the wrong reason counts as a failure.
 *
 * Vectors come from a seeded generator, so the same commit always produces the same
 * campaign and anyone can regenerate and diff it.
 *
 *   node --experimental-strip-types scripts/generate-campaign.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

const SEED = 0x4c494d454e; // 'LIMEN'
const OUT_CAIRO = "contracts/packages/limen_anonymizer/src/tests/campaign_generated.cairo";
const OUT_VECTORS = "evidence/campaigns/vectors.json";

/**
 * xorshift32. Deterministic, tiny, and reproducible in any language, which matters
 * because the vectors are published as evidence.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

type CaseKind =
  | "valid"
  | "below_threshold"
  | "expired"
  | "replay"
  | "wrong_target"
  | "wrong_token"
  | "wrong_subject"
  | "malformed"
  | "direct_call";

interface CampaignCase {
  id: number;
  kind: CaseKind;
  /** What the campaign asserts happens. */
  expectation: "clears" | "rejected";
  /** Cairo error selector a rejection must carry, so a wrong-reason failure fails. */
  expectedError?: string;
  thresholdTokens: number;
  withdrawTokens: number;
  nonce: string;
  clearAtOffsetSeconds: number;
  note: string;
}

const DISTRIBUTION: Array<{ kind: CaseKind; count: number }> = [
  { kind: "valid", count: 25 },
  { kind: "below_threshold", count: 20 },
  { kind: "expired", count: 10 },
  { kind: "replay", count: 10 },
  { kind: "wrong_target", count: 10 },
  { kind: "wrong_token", count: 10 },
  { kind: "wrong_subject", count: 5 },
  { kind: "malformed", count: 5 },
  { kind: "direct_call", count: 5 },
];

const EXPECTED_ERROR: Partial<Record<CaseKind, string>> = {
  below_threshold: "LIMEN_BELOW_THRESHOLD",
  expired: "LIMEN_CHALLENGE_EXPIRED",
  replay: "LIMEN_CHALLENGE_CONSUMED",
  wrong_target: "GATE_CALLER_NOT_LIMEN",
  wrong_token: "GATE_WRONG_TOKEN",
  wrong_subject: "LIMEN_WRONG_SUBJECT",
  malformed: "LIMEN_CHALLENGE_NOT_FOUND",
  direct_call: "LIMEN_CALLER_NOT_POOL",
};

const NOTES: Record<CaseKind, string> = {
  valid: "Correct subject, token, target, action and exact threshold. Must clear and register the allocation.",
  below_threshold: "Less than the threshold reaches the anonymizer. Must not clear.",
  expired: "Cleared after the challenge's expiry second. Must not clear.",
  replay: "A challenge that already cleared is presented again. Must not clear twice.",
  wrong_target: "The challenge names a gate bound to a different Limen deployment. That gate must refuse.",
  wrong_token: "The challenge names a token the gate does not accept. The gate must refuse.",
  wrong_subject: "A subject the challenge is not bound to. Must not clear.",
  malformed: "A challenge identifier that was never created. Must not clear.",
  direct_call: "The anonymizer is called directly rather than through the pool. Must be refused.",
};

function buildCases(): CampaignCase[] {
  const random = makeRandom(SEED);
  const cases: CampaignCase[] = [];
  let id = 0;

  for (const { kind, count } of DISTRIBUTION) {
    for (let index = 0; index < count; index += 1) {
      id += 1;
      // Thresholds span the gate's minimum (10) up to 60 tokens, so the campaign is
      // not one amount repeated a hundred times.
      const thresholdTokens = 10 + (random() % 51);
      let withdrawTokens = thresholdTokens;
      if (kind === "below_threshold") {
        // Anywhere from one token short to almost nothing supplied.
        const shortfall = 1 + (random() % Math.max(1, thresholdTokens - 1));
        withdrawTokens = thresholdTokens - shortfall;
      }

      cases.push({
        id,
        kind,
        expectation: kind === "valid" ? "clears" : "rejected",
        ...(EXPECTED_ERROR[kind] ? { expectedError: EXPECTED_ERROR[kind] } : {}),
        thresholdTokens,
        withdrawTokens,
        nonce: `0x${(0x1000 + id).toString(16)}`,
        clearAtOffsetSeconds: kind === "expired" ? 3601 + (random() % 1000) : random() % 3000,
        note: NOTES[kind],
      });
    }
  }
  return cases;
}

function cairoFor(entry: CampaignCase): string {
  const name = `case_${String(entry.id).padStart(3, "0")}_${entry.kind}`;
  const attributes =
    entry.expectation === "clears"
      ? "#[test]"
      : `#[test]\n#[should_panic(expected: '${entry.expectedError}')]`;

  const body = {
    valid: `    run_valid(${entry.thresholdTokens}, ${entry.nonce}, ${entry.clearAtOffsetSeconds});`,
    below_threshold: `    run_below_threshold(${entry.thresholdTokens}, ${entry.withdrawTokens}, ${entry.nonce});`,
    expired: `    run_expired(${entry.thresholdTokens}, ${entry.nonce}, ${entry.clearAtOffsetSeconds});`,
    replay: `    run_replay(${entry.thresholdTokens}, ${entry.nonce});`,
    wrong_target: `    run_wrong_target(${entry.thresholdTokens}, ${entry.nonce});`,
    wrong_token: `    run_wrong_token(${entry.thresholdTokens}, ${entry.nonce});`,
    wrong_subject: `    run_wrong_subject(${entry.thresholdTokens}, ${entry.nonce});`,
    malformed: `    run_malformed(${entry.nonce});`,
    direct_call: `    run_direct_call(${entry.thresholdTokens}, ${entry.nonce});`,
  }[entry.kind];

  return `/// ${entry.note}\n${attributes}\nfn ${name}() {\n${body}\n}\n`;
}

function main() {
  const cases = buildCases();

  const header = `//! Generated by scripts/generate-campaign.ts. Do not edit by hand.
//!
//! The deterministic adversarial campaign required by PRD §14: ${cases.length} cases over
//! ${DISTRIBUTION.length} attack shapes, seeded from ${`0x${SEED.toString(16)}`} so the same commit always
//! produces the same campaign.
//!
//! Each case is an independent test. A case that must be refused is a \`should_panic\`
//! on the exact error, so a case failing for the wrong reason is a failure, not a
//! pass. Regenerate with:
//!
//!     node --experimental-strip-types scripts/generate-campaign.ts

use super::campaign_harness::{
    run_below_threshold, run_direct_call, run_expired, run_malformed, run_replay, run_valid,
    run_wrong_subject, run_wrong_target, run_wrong_token,
};

`;

  mkdirSync("evidence/campaigns", { recursive: true });
  writeFileSync(OUT_CAIRO, header + cases.map(cairoFor).join("\n"));

  const summary = {
    generated_at: new Date().toISOString(),
    seed: `0x${SEED.toString(16)}`,
    generator: "scripts/generate-campaign.ts",
    total: cases.length,
    distribution: Object.fromEntries(DISTRIBUTION.map(({ kind, count }) => [kind, count])),
    valid_expected: cases.filter((entry) => entry.expectation === "clears").length,
    invalid_expected: cases.filter((entry) => entry.expectation === "rejected").length,
    cases,
  };
  writeFileSync(OUT_VECTORS, JSON.stringify(summary, null, 2) + "\n");

  console.log(
    `generated ${cases.length} cases (${summary.valid_expected} valid, ${summary.invalid_expected} adversarial)`
  );
  console.log(`  ${OUT_CAIRO}`);
  console.log(`  ${OUT_VECTORS}`);
}

main();
