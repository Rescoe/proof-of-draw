// lib/navLinks.ts — navigation du site (UX jalon 1, 29/10/2026) : DEUX présentations d'une même architecture, sans changer aucun chemin.
//   • barre « bureau » (≥ 1025 px) : Accueil · Galerie · Créer une œuvre · Réseau · Communauté ▾ · Apprendre · Mon espace ;
//   • tiroir « tablette / téléphone » (≤ 1024 px) : Accueil, puis quatre groupes PARTICIPER · EXPLORER · MON COMPTE · AIDE.
// Données pures (testées dans tests/navLinks.test.ts et tests/navActive.test.ts). Rien n'est supprimé : « Animations » reste le filtre de la Galerie, « Agents IA » un lien de la Galerie,
// « Connecter mon écran » devient « Associer un appareil » (/onboard) ; toutes les anciennes URL répondent comme avant.

/** Règle sur un paramètre de requête : le lien est (ou n'est pas) actif selon la valeur de `key`. */
export interface QueryRule { key: string; values: string[] }

export interface NavLink {
  href: string;
  label: string;
  /** Préfixes de chemin pour lesquels l'entrée est « active » (le chemin exact de href est toujours inclus). */
  match?: string[];
  /** Actif seulement si le paramètre de requête a l'une de ces valeurs (ex. /learn?path=install). */
  query?: QueryRule;
  /** Jamais actif si le paramètre de requête a l'une de ces valeurs (ex. « Comprendre » n'est pas actif sur /learn?path=install). */
  notQuery?: QueryRule;
}

export type NavEntry =
  | { kind: "link"; id: string; link: NavLink; cta?: boolean }
  | { kind: "menu"; id: string; label: string; links: NavLink[] };

export interface NavGroup { id: "participer" | "explorer" | "compte" | "aide"; label: string; links: NavLink[] }

/** Barre de navigation « bureau » : sept entrées, une seule ligne. « Créer une œuvre » est l'appel à l'action principal. */
export const NAV_ENTRIES: NavEntry[] = [
  { kind: "link", id: "accueil", link: { href: "/", label: "Accueil" } },
  { kind: "link", id: "galerie", link: { href: "/gallery", label: "Galerie", match: ["/gallery-ana", "/gallery-anim"] } },
  { kind: "link", id: "creer", cta: true, link: { href: "/draw", label: "Créer une œuvre", match: ["/animer", "/draw-lab"] } },
  { kind: "link", id: "reseau", link: { href: "/network", label: "Réseau" } },
  { kind: "menu", id: "communaute", label: "Communauté", links: [
    { href: "/artists", label: "Artistes" },
    { href: "/circles", label: "Cercles privés" },
  ] },
  { kind: "link", id: "apprendre", link: { href: "/learn", label: "Apprendre", match: ["/firmware"] } },
  { kind: "link", id: "espace", link: { href: "/profile", label: "Mon espace", match: ["/my-devices", "/onboard"] } },
];

/** Tiroir « tablette / téléphone » : l'accueil en tête, puis des groupes d'intention. */
export const DRAWER_HOME: NavLink = { href: "/", label: "Accueil" };
export const DRAWER_GROUPS: NavGroup[] = [
  { id: "participer", label: "Participer", links: [
    { href: "/draw", label: "Créer une œuvre", match: ["/animer", "/draw-lab"] },
    { href: "/gallery", label: "Galerie", match: ["/gallery-ana", "/gallery-anim"] },
  ] },
  { id: "explorer", label: "Explorer", links: [
    { href: "/network", label: "Réseau en direct" },
    { href: "/artists", label: "Artistes" },
    { href: "/circles", label: "Cercles privés" },
  ] },
  { id: "compte", label: "Mon compte", links: [
    { href: "/profile", label: "Mon espace", match: ["/my-devices"] },
    { href: "/onboard", label: "Associer un appareil" },
  ] },
  { id: "aide", label: "Aide", links: [
    { href: "/learn", label: "Comprendre Proof-of-Draw", match: ["/firmware"], notQuery: { key: "path", values: ["install", "network"] } },
    { href: "/learn?path=install#installer", label: "Installer un appareil", query: { key: "path", values: ["install"] } },
    { href: "/learn?path=network#how", label: "Documentation technique", query: { key: "path", values: ["network"] } },
  ] },
];

export function pathOf(href: string): string {
  return href.split(/[?#]/)[0] || "/";
}

const underPath = (root: string, pathname: string) => (root === "/" ? pathname === "/" : pathname === root || pathname.startsWith(root + "/"));

/** Valeur d'un paramètre dans une chaîne de requête (« ?path=install » ou « path=install »). */
export function queryValue(search: string, key: string): string | null {
  try { return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(key); } catch { return null; }
}

/** Un lien est actif si le chemin courant est (ou est sous) son chemin ou l'un de ses préfixes, et si ses règles de requête sont respectées. L'accueil ne l'est que pour « / ». */
export function isActive(link: NavLink, pathname: string, search = ""): boolean {
  const roots = [pathOf(link.href), ...(link.match ?? [])];
  if (!roots.some((r) => underPath(r, pathname))) return false;
  if (link.query) { const v = queryValue(search, link.query.key); if (v === null || !link.query.values.includes(v)) return false; }
  if (link.notQuery) { const v = queryValue(search, link.notQuery.key); if (v !== null && link.notQuery.values.includes(v)) return false; }
  return true;
}

/** Identifiant de l'unique entrée de la barre « bureau » active pour cette adresse (null si aucune : page hors navigation, ex. /bench). */
export function activeEntryId(pathname: string, search = ""): string | null {
  for (const e of NAV_ENTRIES) {
    const links = e.kind === "link" ? [e.link] : e.links;
    if (links.some((l) => isActive(l, pathname, search))) return e.id;
  }
  return null;
}

/** Les liens du tiroir qui sont actifs pour cette adresse (au plus un par groupe d'intention ; l'accueil est traité à part). */
export function activeDrawerHrefs(pathname: string, search = ""): string[] {
  const out: string[] = [];
  if (isActive(DRAWER_HOME, pathname, search)) out.push(DRAWER_HOME.href);
  for (const g of DRAWER_GROUPS) for (const l of g.links) if (isActive(l, pathname, search)) out.push(l.href);
  return out;
}

/** Tous les liens du site que la navigation expose (barre + tiroir), pour vérifier qu'aucune destination historique n'est perdue. */
export function allNavHrefs(): string[] {
  const hrefs = new Set<string>([DRAWER_HOME.href]);
  for (const e of NAV_ENTRIES) for (const l of e.kind === "link" ? [e.link] : e.links) hrefs.add(l.href);
  for (const g of DRAWER_GROUPS) for (const l of g.links) hrefs.add(l.href);
  return [...hrefs];
}

