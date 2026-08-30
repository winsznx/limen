import Link from "next/link";

const NAV = [
  { href: "/protocol", label: "Protocol" },
  { href: "/console", label: "Console" },
  { href: "/evidence", label: "Evidence" },
];

/**
 * The SDK lives off-site, so it needs its own entry rather than being findable only
 * through the repository. Limen is a primitive, and a primitive whose consumers cannot
 * find the package is not really consumable.
 */
const BUILD_HREF = "https://github.com/winsznx/limen/blob/main/docs/INTEGRATING.md";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ash bg-canvas/90 backdrop-blur-[6px]">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Limen home">
          <Mark />
          <span className="text-[15px] font-medium tracking-[-0.01em] text-charcoal">Limen</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-[9999px] px-4 py-1.5 text-[14px] text-charcoal transition-colors hover:bg-paper"
            >
              {item.label}
            </Link>
          ))}
          <a
            href={BUILD_HREF}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-[9999px] px-4 py-1.5 text-[14px] text-charcoal transition-colors hover:bg-paper"
          >
            Build
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <a
            href="https://github.com/winsznx/limen"
            target="_blank"
            rel="noreferrer noopener"
            className="hidden rounded-[8px] border border-ash px-4 py-1.5 text-[14px] text-charcoal transition-colors hover:bg-paper sm:inline-flex"
          >
            Source
          </a>
          <Link
            href="/challenge"
            className="inline-flex rounded-[8px] bg-ink px-4 py-1.5 text-[14px] font-medium text-canvas shadow-[rgba(0,0,0,0.05)_0px_1px_2px_0px] transition-colors hover:bg-charcoal"
          >
            Try a challenge
          </Link>
        </div>
      </div>
    </header>
  );
}

/**
 * The mark is a threshold: a filled portion meeting a line, with the rest left open.
 * It is the product's one idea, drawn once, rather than a generic crypto glyph.
 */
function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="17" height="17" rx="4.5" stroke="#e5e5e5" />
      <rect x="4" y="9" width="4" height="5" rx="1" fill="#0a0a0a" />
      <rect x="10" y="4" width="4" height="10" rx="1" fill="#e5e5e5" />
      <rect x="3" y="7.25" width="12" height="1.5" rx="0.75" fill="#2563eb" />
    </svg>
  );
}
