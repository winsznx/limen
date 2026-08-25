import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  metadataBase: new URL("https://limen.build"),
  title: {
    default: "Limen — Prove enough. Keep the rest private.",
    template: "%s — Limen",
  },
  description:
    "Limen lets Starknet applications require a capital threshold without asking users to reveal their total shielded balance.",
  openGraph: {
    title: "Limen — Prove enough. Keep the rest private.",
    description:
      "A capital-threshold authorization primitive for STRK20. Prove you can mobilize an amount without disclosing what else you hold.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-canvas antialiased">
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
