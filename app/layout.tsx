import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Proof-of-Draw",
  description: "Réseau de dessins distribués entre ESP8266, écrans e-ink et OLED.",
};

const links = [
  { href: "/onboard", label: "+ Onboard" },
  { href: "/draw", label: "Dessiner" },
  { href: "/my-devices", label: "Mes ESP" },
];

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
              <span className="site-brand__mark">◈</span>
              <span>Proof-of-<em>Draw</em></span>
            </Link>

            <div className="site-nav__links">
              {links.map((link) => (
                <Link key={link.href} href={link.href} className="site-nav__link">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}