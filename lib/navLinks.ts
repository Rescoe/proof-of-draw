// lib/navLinks.ts — navigation du site : 4 entrées principales (les trois intentions + l'installation) et un menu « Plus ».
// Données pures (testées) ; rien n'est supprimé : chaque ancienne destination reste atteignable.

export interface NavLink {
  href: string;
  label: string;
  /** Préfixes de chemin pour lesquels l'entrée est « active » (le chemin exact de href est toujours inclus). */
  match?: string[];
}

export const PRIMARY_LINKS: NavLink[] = [
  { href: "/draw",    label: "Créer",              match: ["/draw", "/animer", "/draw-lab"] },
  { href: "/gallery", label: "Découvrir",          match: ["/gallery", "/artists", "/gallery-ana", "/gallery-anim"] },
  { href: "/profile", label: "Mes écrans",         match: ["/profile", "/my-devices"] },
  { href: "/learn?path=install#installer", label: "Installer un écran", match: ["/learn", "/firmware"] },
];

export const MORE_LINKS: NavLink[] = [
  { href: "/",                       label: "Accueil" },
  { href: "/network",                label: "Réseau en direct" },
  { href: "/gallery?type=animation", label: "Animations" },
  { href: "/gallery-ana",            label: "Agents IA" },
  { href: "/artists",                label: "Artistes" },
  { href: "/circles",                label: "Cercles privés" },
  { href: "/onboard",                label: "Connecter mon écran" },
  { href: "/learn",                  label: "Apprendre et documentation" },
];

function pathOf(href: string): string {
  return href.split(/[?#]/)[0] || "/";
}

/** Une entrée est active si le chemin courant est (ou est sous) l'un de ses préfixes. L'accueil ne l'est que pour « / ». */
export function isActive(link: NavLink, pathname: string): boolean {
  const roots = [pathOf(link.href), ...(link.match ?? [])];
  return roots.some((r) => (r === "/" ? pathname === "/" : pathname === r || pathname.startsWith(r + "/")));
}

/** Entrée « Plus » active si l'une de ses destinations l'est (hors accueil, déjà reconnu par le logo). */
export function isMoreActive(pathname: string): boolean {
  return MORE_LINKS.some((l) => l.href !== "/" && isActive(l, pathname)) && !PRIMARY_LINKS.some((l) => isActive(l, pathname));
}
