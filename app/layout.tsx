import type { Metadata } from "next";
import Link from "next/link";
import { NavMenu } from "./NavMenu";
import "./globals.css";

export const metadata: Metadata = {
  title: "Proof-of-Draw",
  description: "Réseau de dessins distribués entre ESP8266, écrans e-ink et OLED.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
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