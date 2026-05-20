"use client";

// app/NavMenu.tsx — Navigation links + hamburger mobile menu

import { useState, useEffect } from "react";
import Link from "next/link";

const links = [
  { href: "/learn",    label: "Apprendre" },
  { href: "/draw",     label: "Dessiner" },
  { href: "/gallery",  label: "Explorer" },
  { href: "/artists",  label: "Artistes" },
  { href: "/profile",  label: "Mon profil" },
  { href: "/onboard",  label: "+ Onboard" },
];

export function NavMenu() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Desktop */}
      <div className="site-nav__links">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className="site-nav__link">
            {link.label}
          </Link>
        ))}
      </div>

      {/* Mobile hamburger */}
      <button
        className="nav-burger"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Fermer le menu" : "Menu"}
        aria-expanded={open}
      >
        <span className={`nav-burger__icon${open ? " nav-burger__icon--open" : ""}`}>
          <span className="nav-burger__bar" />
          <span className="nav-burger__bar" />
          <span className="nav-burger__bar" />
        </span>
      </button>

      {/* Mobile drawer */}
      {open && (
        <>
          <div className="nav-overlay" onClick={() => setOpen(false)} aria-hidden="true" />
          <nav className="nav-drawer" aria-label="Navigation">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="nav-drawer__link"
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </>
      )}
    </>
  );
}
