import type { Metadata } from "next";
import Link from "next/link";
import { NavMenu } from "./NavMenu";
import "./globals.css";
import { DESCRIPTION, REPOSITORY_URL, SITE_URL } from "@/lib/projectStatus";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Proof-of-Draw — réseau artistique de dessins validés par des appareils",
  description: DESCRIPTION,
  applicationName: "Proof-of-Draw",
  manifest: "/manifest.json",
  authors: [{ name: "Rescoe", url: REPOSITORY_URL }],
  openGraph: { type: "website", siteName: "Proof-of-Draw", locale: "fr_FR", title: "Proof-of-Draw", description: DESCRIPTION },
  twitter: { card: "summary", title: "Proof-of-Draw", description: DESCRIPTION },
  robots: { index: true, follow: true },
};

// Données structurées sobres : décrivent l'application et son code source, sans prix, sans organisation ni licence inventées.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "Proof-of-Draw", url: SITE_URL, inLanguage: "fr", description: DESCRIPTION },
    { "@type": "SoftwareSourceCode", name: "Proof-of-Draw", codeRepository: REPOSITORY_URL, programmingLanguage: ["TypeScript", "C++"], description: DESCRIPTION },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <nav className="site-nav">
          <div className="site-nav__inner">
            <Link href="/" className="site-brand">
              <span className="site-brand__mark">
                <img src="/logo.png" alt="Logo" className="site-logo" />
              </span>
              <span>Proof-of-<em>Draw</em></span>
            </Link>
            <NavMenu />
          </div>
        </nav>

        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}