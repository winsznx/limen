import type { Metadata } from "next";
import { Card, Dot, SectionHead, Tag } from "@/components/primitives";
import { MAINNET, UPSTREAM_PINS } from "@limenlabs/protocol-config";

export const metadata: Metadata = { title: "Protocol" };

export default function ProtocolPage() {
  return (
    <div className="mx-auto max-w-[900px] px-5 py-12">
      <SectionHead eyebrow="Protocol" title="How a clearance actually works" />

      <p className="mb-10 text-[16px] leading-[1.65] text-steel">
        Limen is one Cairo contract and one integration point. The interesting part is not the
        contract, it is which two properties come from the STRK20 pool itself rather than from
        anything a caller supplies.
      </p>

      <Card className="mb-10 overflow-hidden">
        <div className="border-b border-ash px-4 py-2.5 text-[12px] text-fog">
          One atomic pool transaction
        </div>
        <pre className="mono overflow-x-auto p-4 text-[12px] leading-[1.8] text-charcoal">
          {`phase 4   UseNote            spend shielded notes covering the threshold
phase 5   CreateOpenNote     the slot the returned capital is credited into
phase 5   CreateEncNote      change, if the selected notes exceed the threshold
phase 6   Withdraw           exactly the threshold, to the Limen Anonymizer
phase 7   ComputeAndInvoke   privacy_compute, then privacy_invoke_with_computation`}
        </pre>
      </Card>

      <SectionHead eyebrow="Property one" title="The subject cannot be forged" />
      <p className="mb-4 text-[15px] leading-[1.65] text-steel">
        When a transaction uses <span className="mono">ComputeAndInvoke</span>, the pool derives
        an identity key inside the proven execution and hands it to the target&apos;s{" "}
        <span className="mono">privacy_compute</span>:
      </p>
      <Card className="mb-4 overflow-hidden">
        <pre className="mono overflow-x-auto p-4 text-[12px] leading-[1.7] text-charcoal">
          {`identity_key = poseidon(
    IDENTITY_KEY_TAG,
    user_addr,
    user_private_key,     // never leaves the proof
    contract_address      // this anonymizer
)`}
        </pre>
      </Card>
      <p className="mb-10 text-[15px] leading-[1.65] text-steel">
        Deriving it requires the private viewing key, so nobody can present a subject they do not
        hold. It is stable per user and anonymizer, so a verifier can bind a challenge to one
        subject in advance. It differs at every other anonymizer, so a Limen pseudonym cannot be
        correlated across deployments. And it contains no address, so the target application
        never learns who cleared its challenge.
      </p>

      <SectionHead eyebrow="Property two" title="The amount is measured, not asserted" />
      <p className="mb-4 text-[15px] leading-[1.65] text-steel">
        Calldata is caller-supplied, so a claimed amount proves nothing. Instead{" "}
        <span className="mono">privacy_compute</span> snapshots the anonymizer&apos;s token
        balance at the proving base, before any value moves. The proof carries that snapshot
        forward, and the clearing leg measures the difference against the balance at execution:
      </p>
      <Card className="mb-4 overflow-hidden">
        <pre className="mono overflow-x-auto p-4 text-[12px] leading-[1.7] text-charcoal">
          {`received = balance_of(self) - balance_before
assert(received == challenge.threshold)   // exact, not a lower bound`}
        </pre>
      </Card>
      <p className="mb-10 text-[15px] leading-[1.65] text-steel">
        Exact equality rather than a lower bound is deliberate. It keeps the anonymizer&apos;s
        resting balance invariant across every clearance, so a balance that happens to be sitting
        in the contract is never swept into someone&apos;s note.
      </p>

      <SectionHead eyebrow="The boundary" title="What Limen does not prove" />
      <Card className="mb-10 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Dot tone="orange" />
          <h3 className="text-[14px] font-medium text-charcoal">
            An ERC-20 balance carries no provenance
          </h3>
        </div>
        <p className="mb-4 text-[14px] leading-[1.6] text-steel">
          Between the proving base and execution, anyone can transfer the token to the anonymizer
          publicly, and the contract cannot tell that apart from the pool&apos;s own withdrawal.
          So a subject holding part of the threshold publicly can clear a challenge by topping the
          anonymizer up. The capital condition still holds in full, and a subject who cannot raise
          the threshold at all still cannot clear. What is not enforced inside the contract is
          that every unit came from shielded notes.
        </p>
        <p className="mb-4 text-[14px] leading-[1.6] text-steel">
          This cannot be closed on chain. The pool passes the anonymizer no record of what it
          withdrew, <span className="mono">privacy_compute</span> runs at the proving base rather
          than at execution, and only one invoke-phase action is allowed per transaction, so
          there is no second leg to measure with.
        </p>
        <p className="text-[14px] leading-[1.6] text-steel">
          It is measured instead of described. The pool publishes{" "}
          <span className="mono">Withdrawal&#123;to_addr, token, amount&#125;</span> in the same
          transaction, so the split is on chain for every clearance:{" "}
          <span className="mono">Withdrawal.amount == threshold</span> means the whole amount came
          from private notes. Limen&apos;s verifier asserts this on every published transaction,
          and the explorer shows it.
        </p>
      </Card>

      <SectionHead eyebrow="Integration" title="What a target application implements" />
      <Card className="mb-4 overflow-hidden">
        <pre className="mono overflow-x-auto p-4 text-[12px] leading-[1.7] text-charcoal">
          {`#[derive(Serde, Copy, Drop)]
pub struct LimenClearance {
    challenge_id: felt252,      // unique, consumed exactly once
    subject: felt252,           // pseudonym, unforgeable, address-free
    token: ContractAddress,
    amount: u128,               // measured on chain
    action: felt252,            // your own action identifier
    issuer: ContractAddress,
}

fn limen_execute(ref self: T, clearance: LimenClearance);`}
        </pre>
      </Card>
      <p className="mb-10 text-[15px] leading-[1.65] text-steel">
        Limen never accepts a caller-supplied selector. A challenge can only ever cause{" "}
        <span className="mono">limen_execute</span> to run on its bound target, which is what
        stops the anonymizer being used as a general-purpose call proxy while it is holding
        capital. Your application still enforces its own rules: the reference gate checks the
        caller is its Limen deployment, the action is one it recognises, the token is the one it
        accepts, and the amount clears its own minimum.
      </p>

      <SectionHead eyebrow="Pins" title="What Limen is built against" />
      <Card className="px-4">
        <div className="flex items-start justify-between gap-6 border-b border-ash py-3">
          <span className="text-[13px] text-steel">Pool class, mainnet</span>
          <a
            href={MAINNET.explorerClassUrl(UPSTREAM_PINS.poolClassHashMainnet)}
            target="_blank"
            rel="noreferrer noopener"
            title={UPSTREAM_PINS.poolClassHashMainnet}
            className="felt text-right text-[12px] text-charcoal underline decoration-ash underline-offset-2 transition-colors hover:decoration-accent"
          >
            {UPSTREAM_PINS.poolClassHashMainnet}
          </a>
        </div>
        <div className="flex items-start justify-between gap-6 border-b border-ash py-3">
          <span className="text-[13px] text-steel">Upstream revision</span>
          <a
            href={`https://github.com/starkware-libs/starknet-privacy/commit/${UPSTREAM_PINS.poolSourceCommit}`}
            target="_blank"
            rel="noreferrer noopener"
            title={UPSTREAM_PINS.poolSourceTag}
            className="felt text-right text-[12px] text-charcoal underline decoration-ash underline-offset-2 transition-colors hover:decoration-accent"
          >
            {UPSTREAM_PINS.poolSourceCommit}
          </a>
        </div>
        <div className="flex items-start justify-between gap-6 border-b border-ash py-3">
          <span className="text-[13px] text-steel">Pool version</span>
          <span className="mono text-[12px] text-charcoal">{UPSTREAM_PINS.poolVersionMainnet}</span>
        </div>
        <div className="flex items-start justify-between gap-6 border-b border-ash py-3">
          <span className="text-[13px] text-steel">Privacy SDK</span>
          <span className="mono text-[12px] text-charcoal">{UPSTREAM_PINS.privacySdkVersion}</span>
        </div>
        <div className="flex items-start justify-between gap-6 py-3">
          <span className="text-[13px] text-steel">Prover image</span>
          <span className="mono text-right text-[12px] text-charcoal">
            {UPSTREAM_PINS.proverImageTag}
          </span>
        </div>
      </Card>
      <p className="mt-4 text-[13px] leading-[1.6] text-fog">
        The pinned revision is not decorative. It compiles to exactly the class hash deployed at
        the pool, and CI fails if that stops being true, because every interface assumption below
        it would then be suspect.{" "}
        <Tag tone="muted">
          <Dot tone="green" />
          verified
        </Tag>
      </p>
    </div>
  );
}
