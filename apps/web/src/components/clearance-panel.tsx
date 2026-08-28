import { Dot, Tag } from "./primitives";

/**
 * The hero visual, and the product's actual interface.
 *
 * DESIGN.md asks for real interface states rather than decorative art, and PRD §18.1
 * is explicit that no fabricated balance may appear. So the one figure a normal
 * dashboard would show largest, the user's balance, is rendered here as the thing
 * Limen deliberately does not know.
 *
 * `stage` drives which step is current, so the same component serves the landing page
 * and a live clearance.
 */

export type ClearanceStage = "idle" | "proving" | "submitted" | "cleared" | "rejected";

const STEPS: Array<{ key: Exclude<ClearanceStage, "idle" | "rejected">; label: string }> = [
  { key: "proving", label: "Proving" },
  { key: "submitted", label: "Accepted" },
  { key: "cleared", label: "Cleared" },
];

export function ClearancePanel({
  threshold,
  symbol,
  target,
  action,
  provider = "Limen Prover",
  stage = "idle",
  network = "SN_MAIN",
  poolFee,
}: {
  threshold: string;
  symbol: string;
  target: string;
  action: string;
  provider?: string;
  stage?: ClearanceStage;
  network?: string;
  poolFee?: string | null;
}) {
  const activeIndex = STEPS.findIndex((step) => step.key === stage);

  return (
    <div className="rounded-[16px] border border-ash bg-canvas shadow-[rgba(0,0,0,0.1)_0px_0px_0px_4px]">
      <div className="flex items-center justify-between border-b border-ash px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-charcoal">Capital challenge</span>
          <Tag tone="muted">{network}</Tag>
        </div>
        <Tag tone={stage === "cleared" ? "green" : stage === "rejected" ? "orange" : "muted"}>
          <Dot
            tone={stage === "cleared" ? "green" : stage === "rejected" ? "orange" : "grey"}
          />
          {stage === "cleared"
            ? "Cleared"
            : stage === "rejected"
              ? "Rejected"
              : stage === "idle"
                ? "Ready"
                : "In progress"}
        </Tag>
      </div>

      <div className="grid grid-cols-2 gap-px bg-ash">
        <Cell label="Requirement">
          <span className="text-[20px] leading-7 font-medium tracking-[-0.015em] text-charcoal">
            ≥ {threshold} {symbol}
          </span>
        </Cell>
        <Cell label="Your shielded balance">
          {/* The point of the product, stated where a balance would normally sit. */}
          <span className="text-[15px] leading-7 text-fog">Not disclosed</span>
        </Cell>
        <Cell label="Target action">
          <span className="mono text-[13px] text-charcoal">{action}</span>
          <span className="mt-0.5 block truncate text-[12px] text-fog">{target}</span>
        </Cell>
        <Cell label="Proving provider">
          <span className="text-[13px] text-charcoal">{provider}</span>
          <span className="mt-0.5 block text-[12px] text-fog">Self-hosted</span>
        </Cell>
      </div>

      <div className="border-t border-ash px-4 py-3">
        <div className="flex items-center gap-2">
          {STEPS.map((step, index) => {
            const done = activeIndex > index;
            const current = activeIndex === index;
            return (
              <div key={step.key} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex items-center gap-1.5 text-[12px] ${
                    done || current ? "text-charcoal" : "text-silver"
                  }`}
                >
                  <span className={current ? "pulse" : undefined}>
                    <Dot tone={done ? "green" : current ? "accent" : "grey"} />
                  </span>
                  {step.label}
                </span>
                {index < STEPS.length - 1 ? (
                  <span
                    className={`h-px flex-1 ${done ? "bg-green" : "bg-ash"}`}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-ash px-4 py-2.5 text-[11px] text-fog">
        <span>Capital returns to a shielded note in the same transaction</span>
        {poolFee ? <span className="mono">pool fee {poolFee} STRK</span> : null}
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-canvas px-4 py-3.5">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.07em] text-fog">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
