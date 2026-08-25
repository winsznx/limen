/**
 * Runs the adversarial campaign and writes the evidence artefact.
 *
 * The oracle is snforge's own per-test result, cross-referenced against the generated
 * vectors, so this script reports what the test runner observed rather than deciding
 * for itself whether the campaign passed. A case missing from the runner's output is
 * an error, not a silent omission.
 *
 *   node --experimental-strip-types scripts/run-campaign.ts
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const VECTORS = "evidence/campaigns/vectors.json";
const OUTPUT = "evidence/campaigns/security.json";
const CONTRACTS_DIR = "contracts";

interface CampaignCase {
  id: number;
  kind: string;
  expectation: "clears" | "rejected";
  expectedError?: string;
  thresholdTokens: number;
  withdrawTokens: number;
  nonce: string;
  note: string;
}

interface Vectors {
  seed: string;
  total: number;
  distribution: Record<string, number>;
  valid_expected: number;
  invalid_expected: number;
  cases: CampaignCase[];
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Hashes the compiled contract classes so a result is tied to the code that produced it. */
function artifactHash(): string {
  const hash = createHash("sha256");
  for (const path of [
    "contracts/target/dev/limen_anonymizer_LimenAnonymizer.contract_class.json",
    "contracts/target/dev/limen_capital_gate_CapitalGate.contract_class.json",
  ]) {
    if (existsSync(path)) hash.update(readFileSync(path));
  }
  const digest = hash.digest("hex");
  return digest === createHash("sha256").digest("hex") ? "unavailable" : `sha256:${digest}`;
}

function runSnforge(): string {
  try {
    return execFileSync("snforge", ["test", "campaign_generated", "--detailed-resources"], {
      cwd: CONTRACTS_DIR,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.limen-tools/scarb/bin:${process.env.HOME}/.limen-tools/snforge/bin:${process.env.PATH}`,
      },
    });
  } catch (error) {
    // A non-zero exit means cases failed; the output still carries the per-case lines
    // and is exactly what needs recording.
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`;
  }
}

function main() {
  if (!existsSync(VECTORS)) {
    console.error(`${VECTORS} is missing. Run scripts/generate-campaign.ts first.`);
    process.exit(1);
  }
  const vectors = JSON.parse(readFileSync(VECTORS, "utf8")) as Vectors;

  console.log(`running ${vectors.total} campaign cases…`);
  const output = runSnforge();

  const observed = new Map<string, "passed" | "failed">();
  for (const line of output.split("\n")) {
    const match = /^\[(PASS|FAIL)\]\s+\S*campaign_generated::(case_\d+_\w+)/.exec(line.trim());
    if (match) observed.set(match[2]!, match[1] === "PASS" ? "passed" : "failed");
  }

  const results = vectors.cases.map((entry) => {
    const name = `case_${String(entry.id).padStart(3, "0")}_${entry.kind}`;
    const outcome = observed.get(name);
    return {
      id: entry.id,
      name,
      kind: entry.kind,
      expectation: entry.expectation,
      expectedError: entry.expectedError ?? null,
      thresholdTokens: entry.thresholdTokens,
      withdrawTokens: entry.withdrawTokens,
      observed: outcome ?? "missing",
      /**
       * A passing test means the case behaved exactly as specified: a `clears` case
       * cleared and left the fund invariants intact, a `rejected` case was refused
       * with the exact expected error. Failing for a different reason is a failure.
       */
      asSpecified: outcome === "passed",
    };
  });

  const missing = results.filter((entry) => entry.observed === "missing");
  const valid = results.filter((entry) => entry.expectation === "clears");
  const invalid = results.filter((entry) => entry.expectation === "rejected");

  const validObserved = valid.filter((entry) => entry.asSpecified).length;
  const invalidRejected = invalid.filter((entry) => entry.asSpecified).length;

  // A false clearance is an adversarial case that did not get refused.
  const falseClearances = invalid.filter((entry) => !entry.asSpecified);
  const successfulReplays = falseClearances.filter((entry) => entry.kind === "replay");
  // `run_valid` asserts the anonymizer retains nothing and the pool ends whole, so a
  // stranded-funds bug shows up as a failing valid case.
  const fundsStranded = valid.filter((entry) => !entry.asSpecified).length;

  const report = {
    ran_at: new Date().toISOString(),
    commit: gitCommit(),
    contract_artifact_hash: artifactHash(),
    seed: vectors.seed,
    generator: "scripts/generate-campaign.ts",
    runner: "scripts/run-campaign.ts",
    harness: "contracts/packages/limen_anonymizer/src/tests/campaign_harness.cairo",
    oracle:
      "snforge per-test results. Adversarial cases are should_panic on the exact error selector, so a case that fails for the wrong reason counts as a failure.",
    environment: "deterministic snforge, no network, no mainnet funds",

    total: results.length,
    valid_expected: vectors.valid_expected,
    valid_observed: validObserved,
    invalid_expected: vectors.invalid_expected,
    invalid_rejected: invalidRejected,
    false_clearances: falseClearances.length,
    successful_replays: successfulReplays.length,
    funds_stranded: fundsStranded,
    missing_cases: missing.length,

    passed: results.every((entry) => entry.asSpecified) && missing.length === 0,
    distribution: vectors.distribution,
    cases: results,
  };

  mkdirSync("evidence/campaigns", { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(report, null, 2) + "\n");
  writeFileSync("evidence/campaigns/snforge-output.txt", output);

  console.log("");
  console.log(`  total                ${report.total}`);
  console.log(`  valid expected       ${report.valid_expected}`);
  console.log(`  valid observed       ${report.valid_observed}`);
  console.log(`  invalid expected     ${report.invalid_expected}`);
  console.log(`  invalid rejected     ${report.invalid_rejected}`);
  console.log(`  false clearances     ${report.false_clearances}`);
  console.log(`  successful replays   ${report.successful_replays}`);
  console.log(`  funds stranded       ${report.funds_stranded}`);
  console.log("");
  console.log(`  ${report.passed ? "PASS" : "FAIL"} → ${OUTPUT}`);

  if (!report.passed) process.exit(1);
}

main();
