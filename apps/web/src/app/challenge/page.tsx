import type { Metadata } from "next";
import Link from "next/link";
import { formatAmount, findToken, STRK_MAINNET } from "@limen/protocol-config";
import { Card, Dot, Field, NotLive, SectionHead, Tag, short } from "@/components/primitives";
import { deploymentConfig, isDeployed } from "@/lib/config";
import { readClient } from "@/lib/chain";
import type { Challenge } from "@limen/sdk";

export const metadata: Metadata = { title: "Capital challenges" };
export const dynamic = "force-dynamic";

function demoChallengeIds(): string[] {
  return (process.env.LIMEN_DEMO_CHALLENGE_IDS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => /^0x[0-9a-fA-F]+$/.test(entry));
}

export default async function ChallengeIndexPage() {
  const config = deploymentConfig();
  const client = readClient(config);
  const ids = demoChallengeIds();

  const challenges: Challenge[] = [];
  if (client) {
    for (const id of ids) {
      try {
        const challenge = await client.getChallenge(id);
        if (challenge) challenges.push(challenge);
      } catch {
        // A challenge that cannot be read is simply not listed. The page never
        // invents an entry to fill the space.
      }
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] px-5 py-12">
      <SectionHead
        eyebrow="Capital challenges"
        title="Prove a threshold without disclosing the rest"
        aside={<Tag tone="muted">{config.network.chainName}</Tag>}
      />

      <p className="mb-10 max-w-[760px] text-[15px] leading-[1.6] text-steel">
        A challenge is a published requirement, not a grant. Opening one authorises nothing: it
        only becomes an authorization when a subject mobilises exactly the threshold through the
        STRK20 pool and the bound action executes.
      </p>

      {!isDeployed(config) ? (
        <div className="mb-12">
          <NotLive
            what="Limen is not deployed on this network yet."
            detail="The contracts are written, tested and ready. Deployment addresses appear here the moment scripts/deploy.ts has run against mainnet, and this page reads them from chain rather than from a build-time constant."
          />
        </div>
      ) : challenges.length > 0 ? (
        <div className="mb-12 grid gap-4 md:grid-cols-2">
          {challenges.map((challenge) => (
            <ChallengeCard key={challenge.challengeId} challenge={challenge} />
          ))}
        </div>
      ) : (
        <div className="mb-12">
          <NotLive
            what="No open demo challenges right now."
            detail="Limen is deployed, but no challenge is currently open. Any verifier can open one; the snippet below is the whole integration."
          />
        </div>
      )}

      <SectionHead eyebrow="For verifiers" title="Opening a challenge" />
      <Card className="mb-4 overflow-hidden">
        <div className="border-b border-ash px-4 py-2.5 text-[12px] text-fog">
          Any Starknet account can open a challenge. Limen never holds a signing key on your
          behalf.
        </div>
        <pre className="mono overflow-x-auto p-4 text-[12px] leading-[1.7] text-charcoal">
          {`import { LimenIssuer, LimenReadClient, randomNonce } from "@limen/sdk";

const client = new LimenReadClient({ provider, deployment });
const issuer = new LimenIssuer(account, client);

const { challengeId } = await issuer.createChallenge({
  token:     STRK,                       // what counts as capital
  threshold: parseAmount("50", 18),      // exact amount, in base units
  target:    myApp,                      // whose limen_execute runs
  action:    "REGISTER_ALLOCATION",      // your own action identifier
  subject:   userLimenId ?? "0x0",       // "0x0" means any subject may clear it
  issuer:    account.address,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  nonce:     randomNonce(),
});`}
        </pre>
      </Card>

      <Card className="mb-12 overflow-hidden">
        <div className="border-b border-ash px-4 py-2.5 text-[12px] text-fog">
          Your application implements one entry point. Limen calls only this, and only on the
          target the challenge names.
        </div>
        <pre className="mono overflow-x-auto p-4 text-[12px] leading-[1.7] text-charcoal">
          {`#[starknet::interface]
pub trait ILimenTarget<T> {
    fn limen_execute(ref self: T, clearance: LimenClearance);
}

// LimenClearance tells you: which challenge cleared, a subject pseudonym,
// the token, the amount actually mobilised, your action id, and the issuer.
// It does not tell you the subject's address, balance, or notes.`}
        </pre>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <Dot tone="orange" />
          <h3 className="text-[14px] font-medium text-charcoal">Clearing needs a key-holding client today</h3>
        </div>
        <p className="text-[13px] leading-[1.6] text-fog">
          Limen binds a subject using the pool&apos;s own identity key, which is only available
          through the pool&apos;s <span className="mono">ComputeAndInvoke</span> action. The
          Starknet Wallet API (0.10.3) exposes four STRK20 actions and none of them is
          compute-and-invoke, so a browser wallet cannot perform a clearance yet. Clearances
          therefore run through the Privacy SDK route. This is an upstream gap rather than a
          Limen design choice, and it is written up in{" "}
          <a
            href="https://github.com/winsznx/limen/blob/main/CONTRIBUTIONS.md"
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent hover:underline"
          >
            CONTRIBUTIONS.md
          </a>
          .
        </p>
      </Card>
    </div>
  );
}

function ChallengeCard({ challenge }: { challenge: Challenge }) {
  const config = deploymentConfig();
  const token = findToken(config.network.network, challenge.token);
  const decimals = token?.decimals ?? STRK_MAINNET.decimals;
  const open = challenge.open;

  return (
    <Link href={`/challenge/${challenge.challengeId}`} className="block">
      <Card className="p-5 transition-colors hover:bg-paper">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[20px] font-medium tracking-[-0.015em] text-charcoal">
            ≥ {formatAmount(challenge.threshold, decimals)} {token?.symbol ?? "tokens"}
          </span>
          <Tag tone={open ? "green" : "muted"}>
            <Dot tone={open ? "green" : "grey"} />
            {challenge.consumedBy ? "Cleared" : open ? "Open" : "Expired"}
          </Tag>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Action" value={challenge.action} mono />
          <Field label="Target" value={short(challenge.target, 6, 4)} mono />
          <Field
            label="Subject"
            value={BigInt(challenge.subject) === 0n ? "Any (bearer)" : short(challenge.subject, 6, 4)}
            mono
          />
          <Field
            label="Expires"
            value={new Date(challenge.expiresAt * 1000).toISOString().slice(0, 16).replace("T", " ")}
          />
        </div>
      </Card>
    </Link>
  );
}
