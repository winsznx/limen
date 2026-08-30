import type { CSSProperties } from "react";

/**
 * CSS custom properties are not part of React's CSSProperties, so the cast lives here
 * once rather than at every call site.
 */
export function stageVars(index: number, dash?: number): CSSProperties {
  return { "--i": index, ...(dash === undefined ? {} : { "--limen-dash": dash }) } as CSSProperties;
}

export interface MechanismStage {
  readonly key: string;
  readonly label: string;
  readonly caption: string;
}

export const MECHANISM_STAGES: readonly MechanismStage[] = [
  { key: "challenge", label: "Challenge", caption: "Published on chain. Authorises nothing." },
  { key: "prove", label: "Prove", caption: "Limen's own prover, ~49s." },
  { key: "pool", label: "Pool", caption: "Withdraws exactly the threshold." },
  { key: "execute", label: "Execute", caption: "The bound action runs." },
  { key: "return", label: "Return", caption: "Capital back to a shielded note." },
];

/** Node centres on the 900-wide viewBox. Evenly spaced with room for end labels. */
const X = [90, 270, 450, 630, 810];
const Y = 54;

/**
 * The one picture of how Limen works, reused wherever the mechanism needs explaining.
 *
 * Five stages, left to right, drawn as inline SVG and animated with CSS. No client
 * JavaScript: the site ships none, and a diagram is not worth a hydration boundary.
 * The reduced-motion rule in globals.css stops the sequence, so nothing here depends
 * on motion to be understood. The same list is rendered for screen readers.
 *
 * `compact` drops the captions for places where the surrounding copy already says it.
 */

export function Mechanism({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 900 ${compact ? 92 : 128}`}
        className="w-full"
        role="img"
        aria-label="The Limen mechanism: challenge, prove, pool, execute, return to shielded state."
      >
        {/* Connectors first, so nodes sit above them. */}
        {X.slice(0, -1).map((x, index) => (
          <line
            key={`path-${index}`}
            x1={x + 26}
            y1={Y}
            x2={X[index + 1] - 26}
            y2={Y}
            className="stage-path"
            stroke="var(--color-smoke)"
            strokeWidth="1.5"
            style={stageVars(index, 128)}
          />
        ))}

        {MECHANISM_STAGES.map((stage, index) => {
          const x = X[index];
          // The final stage returns to shielded state, so it reads as the pool's colour
          // rather than the anonymizer's. Everything else is one accent.
          const isReturn = index === MECHANISM_STAGES.length - 1;
          return (
            <g key={stage.key} className="stage" style={stageVars(index)}>
              <circle
                cx={x}
                cy={Y}
                r="24"
                fill="var(--color-canvas)"
                stroke={isReturn ? "var(--color-green)" : "var(--color-accent)"}
                strokeWidth="1.5"
              />
              <text
                x={x}
                y={Y + 4}
                textAnchor="middle"
                className="mono"
                fontSize="12"
                fill={isReturn ? "var(--color-green)" : "var(--color-accent)"}
              >
                {index + 1}
              </text>
              <text
                x={x}
                y={Y + 46}
                textAnchor="middle"
                fontSize="13"
                fontWeight="500"
                fill="var(--color-charcoal)"
              >
                {stage.label}
              </text>
              {compact ? null : (
                <text x={x} y={Y + 66} textAnchor="middle" fontSize="11" fill="var(--color-fog)">
                  {stage.caption}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <figcaption className="sr-only">
        <ol>
          {MECHANISM_STAGES.map((stage) => (
            <li key={stage.key}>
              {stage.label}. {stage.caption}
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}

/**
 * The same five stages as a vertical list, for narrow columns and for surfaces where a
 * specific stage has been reached.
 *
 * `completed` is a count, not an index, so passing MECHANISM_STAGES.length marks the
 * whole sequence finished. That distinction matters: a cleared challenge has done all
 * five, and showing the last one as merely in progress reads as unfinished.
 *
 * Passing it also switches the component from explaining the mechanism to reporting a
 * position in it, so the animation stops. A settled status must not look like a loop.
 */
export function MechanismSteps({
  completed,
  className = "",
}: {
  completed?: number;
  className?: string;
}) {
  const live = completed !== undefined;
  return (
    <ol className={`flex flex-col gap-0 ${className}`}>
      {MECHANISM_STAGES.map((stage, index) => {
        const done = live && index < completed;
        const active = live && index === completed;
        const tone = done
          ? "var(--color-green)"
          : active
            ? "var(--color-accent)"
            : "var(--color-smoke)";
        return (
          <li key={stage.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={live ? "" : "stage"}
                style={live ? undefined : stageVars(index)}
                aria-hidden
              >
                <svg width="18" height="18" viewBox="0 0 18 18">
                  <circle cx="9" cy="9" r="7" fill="none" stroke={tone} strokeWidth="1.5" />
                  {done ? (
                    <path
                      d="M5.5 9.2l2.2 2.2 4.6-4.6"
                      fill="none"
                      stroke={tone}
                      strokeWidth="1.75"
                      strokeLinecap="round"
                    />
                  ) : null}
                </svg>
              </span>
              {index < MECHANISM_STAGES.length - 1 ? (
                <span className="w-px flex-1" style={{ background: "var(--color-ash)" }} />
              ) : null}
            </div>
            <div className="pb-4">
              <div className="text-[13px] font-medium text-charcoal">{stage.label}</div>
              <div className="text-[12px] leading-5 text-fog">{stage.caption}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
