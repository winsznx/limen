import type { ReactNode } from "react";
import type { NetworkConfig } from "@limen/protocol-config";

/**
 * The small vocabulary every Limen surface is built from.
 *
 * Borders define containers, not shadows. One accent, used sparingly. Density over
 * decoration. And a deliberate `Unknown` state everywhere a value comes from chain,
 * so a surface reads correctly when the answer genuinely is not known yet — which is
 * the difference between an honest dashboard and a decorative one.
 */

export function Card({
  children,
  className = "",
  as: Element = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <Element className={`rounded-[12px] border border-ash bg-canvas ${className}`}>
      {children}
    </Element>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[16px] border border-ash bg-canvas ${className}`}>{children}</div>
  );
}

export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "green" | "orange" | "violet" | "muted";
}) {
  const tones: Record<string, string> = {
    neutral: "border-ash text-charcoal",
    accent: "border-ash text-accent",
    green: "border-ash text-green",
    orange: "border-ash text-tangerine",
    violet: "border-ash text-lavender",
    muted: "border-ash text-fog",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[9999px] border px-2.5 py-[3px] text-[11px] leading-5 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: "green" | "orange" | "red" | "grey" | "accent" }) {
  const tones: Record<string, string> = {
    green: "bg-green",
    orange: "bg-tangerine",
    red: "bg-[#dc2626]",
    grey: "bg-silver",
    accent: "bg-accent",
  };
  return <span className={`inline-block size-[6px] shrink-0 rounded-full ${tones[tone]}`} />;
}

/**
 * A labelled value. `value` of `null` renders as an explicit unknown rather than an
 * em dash that could be mistaken for zero.
 */
export function Field({
  label,
  value,
  mono = false,
  hint,
}: {
  label: string;
  value: ReactNode | null;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-[0.07em] text-fog">{label}</span>
      {value === null || value === undefined ? (
        <span className="text-[14px] text-silver">Not available</span>
      ) : (
        <span className={`text-[14px] text-charcoal ${mono ? "felt" : ""}`}>{value}</span>
      )}
      {hint ? <span className="text-[11px] leading-4 text-fog">{hint}</span> : null}
    </div>
  );
}

export function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-ash py-3 last:border-b-0">
      <span className="shrink-0 text-[13px] text-steel">{label}</span>
      <span className="text-right text-[13px] text-charcoal">{children}</span>
    </div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "outline",
  external = false,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "outline" | "ghost";
  external?: boolean;
}) {
  const variants: Record<string, string> = {
    primary:
      "bg-ink text-canvas border border-ink hover:bg-charcoal shadow-[rgba(0,0,0,0.05)_0px_1px_2px_0px]",
    outline: "bg-canvas text-charcoal border border-ash hover:bg-paper",
    ghost: "bg-transparent text-charcoal border border-transparent hover:bg-paper",
  };
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
      className={`inline-flex items-center gap-2 rounded-[8px] px-4 py-2 text-[14px] font-medium transition-colors ${variants[variant]}`}
    >
      {children}
    </a>
  );
}

/** Shortens a felt for display while keeping enough to recognise it. */
export function short(value: string | null | undefined, lead = 6, tail = 4): string {
  if (!value) return "";
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (normalized.length <= lead + tail + 3) return normalized;
  return `${normalized.slice(0, lead + 2)}…${normalized.slice(-tail)}`;
}

/**
 * A felt that exists on chain, rendered as a link to the explorer.
 *
 * Every address and transaction hash Limen publishes is a claim someone should be able
 * to check without trusting this page, so none of them are dead text. The full value
 * stays in `title` because the visible form is abbreviated.
 *
 * Only use this for something the explorer can actually resolve. A subject pseudonym
 * and a challenge identifier are felts too, and linking them would send a reader to a
 * page that does not exist.
 */
export function FeltLink({
  value,
  network,
  kind,
  lead = 8,
  tail = 6,
  className = "",
}: {
  value: string | null | undefined;
  network: Pick<NetworkConfig, "explorerTxUrl" | "explorerContractUrl">;
  kind: "tx" | "contract";
  lead?: number;
  tail?: number;
  className?: string;
}) {
  if (!value) return null;
  const href = kind === "tx" ? network.explorerTxUrl(value) : network.explorerContractUrl(value);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={value}
      className={`felt text-accent underline decoration-ash underline-offset-2 transition-colors hover:decoration-accent ${className}`}
    >
      {short(value, lead, tail)}
    </a>
  );
}

/** A section heading with the optional right-hand slot the dense layouts use. */
export function SectionHead({
  eyebrow,
  title,
  aside,
}: {
  eyebrow?: string;
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-6">
      <div>
        {eyebrow ? (
          <div className="mb-2 text-[11px] uppercase tracking-[0.09em] text-fog">{eyebrow}</div>
        ) : null}
        <h2 className="text-[24px] leading-[1.25] font-medium tracking-[-0.015em] text-charcoal">
          {title}
        </h2>
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  );
}

/**
 * Says plainly that something is not live yet. Used instead of rendering a plausible
 * placeholder, which is the failure mode this whole file exists to avoid.
 */
export function NotLive({ what, detail }: { what: string; detail?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <span className="mt-[7px]">
          <Dot tone="grey" />
        </span>
        <div>
          <div className="text-[14px] text-charcoal">{what}</div>
          {detail ? <div className="mt-1 text-[13px] leading-5 text-fog">{detail}</div> : null}
        </div>
      </div>
    </Card>
  );
}
