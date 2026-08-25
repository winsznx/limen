import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-ash">
      <div className="mx-auto max-w-[1200px] px-5 py-10">
        <div className="flex flex-col justify-between gap-8 sm:flex-row">
          <div className="max-w-[420px]">
            <div className="text-[14px] font-medium text-charcoal">Limen</div>
            <p className="mt-2 text-[13px] leading-5 text-fog">
              A capital-threshold authorization primitive for STRK20, plus the proving
              infrastructure that makes it work. Limen proves a bounded capital condition. It is
              not identity anonymity, and it is not proof of solvency.
            </p>
          </div>

          <div className="flex gap-12">
            <nav className="flex flex-col gap-2" aria-label="Product">
              <span className="text-[11px] uppercase tracking-[0.07em] text-fog">Product</span>
              <Link href="/challenge" className="text-[13px] text-charcoal hover:text-accent">
                Challenge
              </Link>
              <Link href="/protocol" className="text-[13px] text-charcoal hover:text-accent">
                Protocol
              </Link>
              <Link href="/console" className="text-[13px] text-charcoal hover:text-accent">
                Console
              </Link>
              <Link href="/evidence" className="text-[13px] text-charcoal hover:text-accent">
                Evidence
              </Link>
            </nav>

            <nav className="flex flex-col gap-2" aria-label="Open source">
              <span className="text-[11px] uppercase tracking-[0.07em] text-fog">Open source</span>
              <a
                href="https://github.com/winsznx/limen"
                target="_blank"
                rel="noreferrer noopener"
                className="text-[13px] text-charcoal hover:text-accent"
              >
                Repository
              </a>
              <a
                href="https://github.com/winsznx/limen/blob/main/SECURITY.md"
                target="_blank"
                rel="noreferrer noopener"
                className="text-[13px] text-charcoal hover:text-accent"
              >
                Security
              </a>
              <a
                href="https://github.com/winsznx/limen/blob/main/DECISIONS.md"
                target="_blank"
                rel="noreferrer noopener"
                className="text-[13px] text-charcoal hover:text-accent"
              >
                Decisions
              </a>
              <a
                href="https://strk20-by-example.org"
                target="_blank"
                rel="noreferrer noopener"
                className="text-[13px] text-charcoal hover:text-accent"
              >
                STRK20
              </a>
            </nav>
          </div>
        </div>

        <div className="mt-10 flex flex-col justify-between gap-3 border-t border-ash pt-6 text-[12px] text-fog sm:flex-row">
          <span>Apache-2.0. Built for the STRK20 Private Sprint.</span>
          <span className="mono">Starknet Mainnet · SN_MAIN</span>
        </div>
      </div>
    </footer>
  );
}
