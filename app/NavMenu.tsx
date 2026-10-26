"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { MORE_LINKS, PRIMARY_LINKS, isActive, isMoreActive } from "@/lib/navLinks";

export function NavMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Close on route change
  useEffect(() => {
    close();
    document.querySelectorAll(".site-nav__more").forEach((d) => d.removeAttribute("open"));   // ferme aussi le menu « Plus » du bureau
  }, [pathname, close]);

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
        {PRIMARY_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`site-nav__link${isActive(link, pathname) ? " site-nav__link--active" : ""}`}
          >
            {link.label}
          </Link>
        ))}
        <details className="site-nav__more">
          <summary className={`site-nav__link${isMoreActive(pathname) ? " site-nav__link--active" : ""}`}>Plus ▾</summary>
          <div className="site-nav__more-menu">
            {MORE_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className={`nav-drawer__link${isActive(link, pathname) ? " nav-drawer__link--active" : ""}`}>
                {link.label}
              </Link>
            ))}
          </div>
        </details>
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
            {PRIMARY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-drawer__link${isActive(link, pathname) ? " nav-drawer__link--active" : ""}`}
                onClick={close}
              >
                {link.label}
              </Link>
            ))}
            <div className="nav-drawer__sep">Plus</div>
            {MORE_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-drawer__link${isActive(link, pathname) ? " nav-drawer__link--active" : ""}`}
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
