"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/",         label: "Accueil" },
  { href: "/draw",     label: "Dessiner" },
  { href: "/gallery",  label: "Explorer" },
  { href: "/artists",  label: "Artistes" },
  { href: "/learn",    label: "Apprendre" },
  { href: "/profile",  label: "Mon profil" },
  { href: "/onboard",  label: "+ Onboard" },
];

export function NavMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Close on route change
  useEffect(() => { close(); }, [pathname, close]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      {/* Desktop */}
      <div className="site-nav__links">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`site-nav__link${pathname === link.href ? " site-nav__link--active" : ""}`}
          >
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
          <div className="nav-overlay" onClick={close} aria-hidden="true" />
          <nav className="nav-drawer" aria-label="Navigation">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-drawer__link${pathname === link.href ? " nav-drawer__link--active" : ""}`}
                onClick={close}
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
