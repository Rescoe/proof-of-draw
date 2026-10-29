"use client";

// app/NavMenu.tsx — navigation du site (UX jalon 1, 29/10/2026). Deux présentations d'UNE architecture (lib/navLinks.ts) :
//   • barre « bureau » (≥ 1025 px) : sept entrées sur une seule ligne, « Communauté » est un menu ;
//   • tiroir « tablette / téléphone » (≤ 1024 px) : Accueil + quatre groupes PARTICIPER · EXPLORER · MON COMPTE · AIDE.
// Accessibilité : aria-current sur le lien actif, Échap et clic extérieur pour « Communauté » ; tiroir avec focus piégé (Tab / Maj+Tab restent dedans), focus sur le premier lien à l'ouverture et rendu au bouton à la fermeture, reste de la page inerte.
// useSearchParams() exige une frontière Suspense (pages statiques) : le repli rend la même navigation sans règle de requête.
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { DRAWER_GROUPS, DRAWER_HOME, NAV_ENTRIES, activeEntryId, isActive, type NavLink } from "@/lib/navLinks";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function CommunityMenu({ id, label, links, pathname, search, active }: { id: string; label: string; links: NavLink[]; pathname: string; search: string; active: boolean }) {
  const pageKey = `${pathname}${search}`;
  const [openKey, setOpenKey] = useState<string | null>(null);   // clé de la page où le menu a été ouvert : changer de page le referme sans effet de bord
  const open = openKey === pageKey;
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const close = useCallback((restore = false) => { setOpenKey(null); if (restore) btnRef.current?.focus(); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(true); };
    const onDown = (e: MouseEvent | TouchEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); document.removeEventListener("touchstart", onDown); };
  }, [open, close]);

  return (
    <div className="site-nav__menu" ref={wrapRef}>
      <button ref={btnRef} type="button" id={`nav-${id}-btn`} className={`site-nav__link site-nav__menu-btn${active ? " site-nav__link--active" : ""}`}
        aria-haspopup="menu" aria-expanded={open} aria-controls={`nav-${id}-menu`} aria-current={active ? "page" : undefined} onClick={() => setOpenKey(open ? null : pageKey)}>
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="site-nav__menu-list" id={`nav-${id}-menu`} role="menu" aria-labelledby={`nav-${id}-btn`}>
          {links.map((l) => {
            const on = isActive(l, pathname, search);
            return <Link key={l.href} href={l.href} role="menuitem" className={`nav-drawer__link${on ? " nav-drawer__link--active" : ""}`} aria-current={on ? "page" : undefined} onClick={() => close()}>{l.label}</Link>;
          })}
        </div>
      )}
    </div>
  );
}

function NavMenuView({ search }: { search: string }) {
  const pathname = usePathname();
  const pageKey = `${pathname}${search}`;
  const [openKey, setOpenKey] = useState<string | null>(null);   // idem : le tiroir se referme quand la page change
  const open = openKey === pageKey;
  const burgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const close = useCallback((restore = false) => { setOpenKey(null); if (restore) burgerRef.current?.focus(); }, []);
  const activeId = activeEntryId(pathname, search);

  // Défilement du corps verrouillé, reste de la page inerte (le focus clavier ne peut pas s'y échapper), focus sur le premier lien
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const main = document.querySelector<HTMLElement>(".site-main");
    main?.setAttribute("inert", "");
    drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => { document.body.style.overflow = ""; main?.removeAttribute("inert"); };
  }, [open]);

  // Échap ferme et rend le focus ; Tab / Maj+Tab restent dans le tiroir (bouton compris)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(true); return; }
      if (e.key !== "Tab" || !drawerRef.current) return;
      const items = [burgerRef.current, ...Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))].filter((x): x is HTMLElement => !!x);
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1], cur = document.activeElement;
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const cur = (l: NavLink) => isActive(l, pathname, search);

  return (
    <>
      {/* Bureau */}
      <div className="site-nav__links">
        {NAV_ENTRIES.map((e) => e.kind === "link" ? (
          <Link key={e.id} href={e.link.href} aria-current={activeId === e.id ? "page" : undefined}
            className={`site-nav__link${e.cta ? " site-nav__link--cta" : ""}${activeId === e.id ? " site-nav__link--active" : ""}`}>
            {e.link.label}
          </Link>
        ) : (
          <CommunityMenu key={e.id} id={e.id} label={e.label} links={e.links} pathname={pathname} search={search} active={activeId === e.id} />
        ))}
      </div>

      {/* Tablette / téléphone */}
      <button ref={burgerRef} className="nav-burger" onClick={() => setOpenKey(open ? null : pageKey)} aria-label={open ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={open} aria-controls="nav-drawer">
        <span className={`nav-burger__icon${open ? " nav-burger__icon--open" : ""}`}>
          <span className="nav-burger__bar" />
          <span className="nav-burger__bar" />
          <span className="nav-burger__bar" />
        </span>
      </button>

      {open && (
        <>
          <div className="nav-overlay" onClick={() => close(true)} aria-hidden="true" />
          <nav className="nav-drawer" id="nav-drawer" aria-label="Navigation" ref={drawerRef}>
            <Link href={DRAWER_HOME.href} className={`nav-drawer__link nav-drawer__home${cur(DRAWER_HOME) ? " nav-drawer__link--active" : ""}`} aria-current={cur(DRAWER_HOME) ? "page" : undefined} onClick={() => close()}>
              {DRAWER_HOME.label}
            </Link>
            {DRAWER_GROUPS.map((g) => (
              <div key={g.id} role="group" aria-labelledby={`nav-g-${g.id}`} className="nav-drawer__group">
                <div className="nav-drawer__sep" id={`nav-g-${g.id}`}>{g.label}</div>
                {g.links.map((l) => (
                  <Link key={l.href} href={l.href} className={`nav-drawer__link${cur(l) ? " nav-drawer__link--active" : ""}`} aria-current={cur(l) ? "page" : undefined} onClick={() => close()}>
                    {l.label}
                  </Link>
                ))}
              </div>
            ))}
          </nav>
        </>
      )}
    </>
  );
}

function NavMenuWithSearch() {
  const sp = useSearchParams();
  return <NavMenuView search={sp ? `?${sp.toString()}` : ""} />;
}

export function NavMenu() {
  return (
    <Suspense fallback={<NavMenuView search="" />}>
      <NavMenuWithSearch />
    </Suspense>
  );
}
