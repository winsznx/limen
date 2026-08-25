import { hash, num, type RpcProvider } from "starknet";

/**
 * Independent verification of a Limen clearance from nothing but its transaction hash.
 *
 * This is what turns a published transaction hash into evidence. It does not trust the
 * app, the SDK, or any indexer: it reads the receipt and reconstructs the whole
 * mechanism from the events the pool and the contracts emitted.
 *
 * The check that matters most is `privateSourced`. Limen's contract can require that
 * exactly the threshold reached the anonymizer, but an ERC-20 balance carries no
 * provenance, so it cannot tell pool-withdrawn capital from a public transfer that
 * landed in the proving window (DECISIONS.md D-007). The pool publishes what it
 * withdrew and to whom, in the same transaction, which closes the gap here: if the
 * pool's `Withdrawal.amount` equals the cleared amount, the whole threshold came from
 * shielded notes.
 */
export interface ClearanceVerification {
  transactionHash: string;
  status: "verified" | "failed";
  blockNumber: number | null;
  /** Every check below passed. */
  ok: boolean;
  checks: {
    /** The transaction executed successfully on chain. */
    succeeded: boolean;
    /** The STRK20 pool was actually touched. */
    poolTouched: boolean;
    /** The pool invoked the Limen Anonymizer, and by which entry point. */
    anonymizerInvoked: boolean;
    invokeSelector: "privacy_invoke_with_computation" | "privacy_invoke" | null;
    /** Limen emitted a clearance. */
    challengeCleared: boolean;
    /** The bound target application recorded the action. */
    targetActionExecuted: boolean;
    /** The capital returned to a shielded open note. */
    capitalReturnedShielded: boolean;
    /** The amount returned equals the amount cleared. */
    returnMatchesThreshold: boolean;
    /** The pool withdrew the full threshold, so every unit came from private notes. */
    privateSourced: boolean;
  };
  observed: {
    challengeId: string | null;
    subject: string | null;
    target: string | null;
    token: string | null;
    /** Threshold the anonymizer measured and cleared. */
    clearedAmount: string | null;
    /** Amount the pool withdrew to the anonymizer. */
    withdrawnFromPool: string | null;
    /** Amount credited back into the shielded open note. */
    creditedToOpenNote: string | null;
    /** Difference between the cleared amount and what the pool withdrew. */
    publiclyToppedUp: string | null;
  };
  problems: string[];
}

interface EventLike {
  from_address: string;
  keys: string[];
  data: string[];
}

const SELECTORS = {
  withdrawal: num.toHex(hash.getSelectorFromName("Withdrawal")),
  openNoteDeposited: num.toHex(hash.getSelectorFromName("OpenNoteDeposited")),
  externalContractInvoked: num.toHex(hash.getSelectorFromName("ExternalContractInvoked")),
  challengeCleared: num.toHex(hash.getSelectorFromName("ChallengeCleared")),
  allocationRegistered: num.toHex(hash.getSelectorFromName("AllocationRegistered")),
  privacyInvokeWithComputation: num.toHex(
    hash.getSelectorFromName("privacy_invoke_with_computation")
  ),
  privacyInvoke: num.toHex(hash.getSelectorFromName("privacy_invoke")),
};

const same = (left: string | undefined, right: string | undefined): boolean =>
  left !== undefined && right !== undefined && BigInt(left) === BigInt(right);

function matching(events: EventLike[], from: string, selector: string): EventLike[] {
  return events.filter(
    (event) => same(event.from_address, from) && same(event.keys[0], selector)
  );
}

export interface VerifyOptions {
  poolAddress: string;
  anonymizerAddress: string;
  /** Optional: when given, the target's own event is required too. */
  targetAddress?: string;
}

export async function verifyClearanceTransaction(
  provider: RpcProvider,
  transactionHash: string,
  options: VerifyOptions
): Promise<ClearanceVerification> {
  const receipt = (await provider.getTransactionReceipt(transactionHash)) as unknown as {
    execution_status?: string;
    finality_status?: string;
    block_number?: number;
    events?: EventLike[];
    revert_reason?: string;
  };

  const events = receipt.events ?? [];
  const problems: string[] = [];
  const succeeded = receipt.execution_status === "SUCCEEDED";
  if (!succeeded) {
    problems.push(`execution_status is ${receipt.execution_status ?? "unknown"}`);
  }

  const poolTouched = events.some((event) => same(event.from_address, options.poolAddress));
  if (!poolTouched) problems.push("no event from the STRK20 pool");

  const invokes = matching(events, options.poolAddress, SELECTORS.externalContractInvoked).filter(
    (event) => same(event.keys[1], options.anonymizerAddress)
  );
  const invokeSelectorKey = invokes[0]?.keys[2];
  const invokeSelector = invokeSelectorKey
    ? same(invokeSelectorKey, SELECTORS.privacyInvokeWithComputation)
      ? ("privacy_invoke_with_computation" as const)
      : same(invokeSelectorKey, SELECTORS.privacyInvoke)
        ? ("privacy_invoke" as const)
        : null
    : null;
  if (invokes.length === 0) problems.push("the pool did not invoke the Limen Anonymizer");

  const cleared = matching(events, options.anonymizerAddress, SELECTORS.challengeCleared)[0];
  if (!cleared) problems.push("the anonymizer emitted no ChallengeCleared");

  const challengeId = cleared?.keys[1] ?? null;
  const subject = cleared?.keys[2] ?? null;
  const target = cleared?.keys[3] ?? null;
  const token = cleared?.data[0] ?? null;
  const clearedAmount = cleared?.data[1] ?? null;

  const withdrawal = matching(events, options.poolAddress, SELECTORS.withdrawal).find(
    (event) => same(event.keys[1], options.anonymizerAddress)
  );
  // Withdrawal keys: [selector, to_addr, token]; data: [enc_user_addr x3, amount].
  const withdrawnFromPool = withdrawal?.data[3] ?? null;
  if (!withdrawal) problems.push("the pool emitted no Withdrawal to the anonymizer");

  const deposited = matching(events, options.poolAddress, SELECTORS.openNoteDeposited).find(
    (event) => same(event.keys[1], options.anonymizerAddress)
  );
  // OpenNoteDeposited keys: [selector, depositor, token, note_id]; data: [amount].
  const creditedToOpenNote = deposited?.data[0] ?? null;
  if (!deposited) problems.push("the capital was not credited back to an open note");

  const targetAddress = options.targetAddress ?? (target ? num.toHex(target) : undefined);
  const allocation = targetAddress
    ? matching(events, targetAddress, SELECTORS.allocationRegistered)[0]
    : undefined;
  if (!allocation) problems.push("the bound target application recorded no action");

  const returnMatchesThreshold = same(clearedAmount ?? undefined, creditedToOpenNote ?? undefined);
  if (clearedAmount && creditedToOpenNote && !returnMatchesThreshold) {
    problems.push(
      `cleared ${BigInt(clearedAmount)} but returned ${BigInt(creditedToOpenNote)} to the note`
    );
  }

  const privateSourced = same(clearedAmount ?? undefined, withdrawnFromPool ?? undefined);
  let publiclyToppedUp: string | null = null;
  if (clearedAmount && withdrawnFromPool) {
    const gap = BigInt(clearedAmount) - BigInt(withdrawnFromPool);
    publiclyToppedUp = gap.toString();
    if (gap > 0n) {
      problems.push(
        `${gap} base units of the threshold were transferred publicly to the anonymizer rather than withdrawn from shielded notes`
      );
    }
  }

  const checks = {
    succeeded,
    poolTouched,
    anonymizerInvoked: invokes.length > 0,
    invokeSelector,
    challengeCleared: Boolean(cleared),
    targetActionExecuted: Boolean(allocation),
    capitalReturnedShielded: Boolean(deposited),
    returnMatchesThreshold,
    privateSourced,
  };

  return {
    transactionHash,
    status: succeeded ? "verified" : "failed",
    blockNumber: receipt.block_number ?? null,
    ok: problems.length === 0,
    checks,
    observed: {
      challengeId: challengeId ? num.toHex(challengeId) : null,
      subject: subject ? num.toHex(subject) : null,
      target: target ? num.toHex(target) : null,
      token: token ? num.toHex(token) : null,
      clearedAmount: clearedAmount ? BigInt(clearedAmount).toString() : null,
      withdrawnFromPool: withdrawnFromPool ? BigInt(withdrawnFromPool).toString() : null,
      creditedToOpenNote: creditedToOpenNote ? BigInt(creditedToOpenNote).toString() : null,
      publiclyToppedUp,
    },
    problems,
  };
}
