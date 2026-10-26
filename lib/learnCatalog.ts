// lib/learnCatalog.ts — catalogue de la page « Apprendre » : types, recherche, filtres, routage des anciennes ancres. Logique PURE (testée), aucune lecture de fichier ici.
//
// Principe : on RANGE sans rien retirer. Chaque section qui existait (ancre `#…`) devient une entrée du catalogue avec deux axes distincts :
//   • PROFONDEUR (qu'est-ce qu'il faut savoir ?) : Découvrir · Installer et pratiquer · Comprendre en profondeur ;
//   • TYPE (quelle sorte de contenu ?) : Guide · Concept · Dépannage · Référence · État du projet.
// La recherche porte sur le titre, un résumé, des mots-clés choisis (synonymes, vocabulaire de débutant) et, pour les documents markdown, le texte de la section.

export type LearnPath = "install" | "no-esp" | "network" | "power" | "synthesis" | "help" | "roadmap" | "compat";
export const LEARN_PATHS: LearnPath[] = ["install", "no-esp", "network", "power", "synthesis", "help", "roadmap", "compat"];
export type Depth = "decouvrir" | "pratiquer" | "comprendre";
export type Kind = "guide" | "concept" | "depannage" | "reference" | "etat";

export const DEPTH_LABEL: Record<Depth, string> = { decouvrir: "Découvrir", pratiquer: "Installer et pratiquer", comprendre: "Comprendre en profondeur" };
export const DEPTH_HINT: Record<Depth, string> = { decouvrir: "Aucune connaissance requise", pratiquer: "Tutoriels et actions concrètes", comprendre: "Architecture, consensus, sécurité, référence technique" };
export const KIND_LABEL: Record<Kind, string> = { guide: "Guide", concept: "Concept", depannage: "Dépannage", reference: "Référence", etat: "État du projet" };
export const PATH_LABEL: Record<LearnPath, string> = {
  install: "Installer un écran", "no-esp": "Participer sans ESP", network: "Comprendre le réseau", power: "Consommation électrique",
  synthesis: "Synthèse technique", help: "Dépannage", roadmap: "Feuille de route", compat: "Compatibilité matérielle",
};
export const DEPTHS: Depth[] = ["decouvrir", "pratiquer", "comprendre"];
export const KINDS: Kind[] = ["guide", "concept", "depannage", "reference", "etat"];

export interface CatalogEntry {
  id: string;
  title: string;
  summary: string;
  kind: Kind;
  depth: Depth;
  path: LearnPath;
  /** Ancre (sans #) dans la page du parcours : elle doit exister dans le rendu (testé). */
  anchor: string;
  /** Mots que l'on tape pour chercher ce sujet sans en connaître le nom exact (synonymes, vocabulaire de débutant). */
  keywords?: string[];
  /** Texte intégral facultatif (documents markdown) : cherché avec le poids le plus faible. */
  body?: string;
}

export const hrefOf = (e: Pick<CatalogEntry, "path" | "anchor">): string => `/learn?path=${e.path}#${e.anchor}`;

// ── Recherche ────────────────────────────────────────────────────────────────
/** minuscules, sans accents, ponctuation → espaces (« Wi‑Fi », « wifi » et « wi-fi » se rejoignent : on retire aussi les tirets dans une copie). */
export function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
const squash = (s: string) => normalize(s).replace(/ /g, "");

export function tokens(query: string): string[] {
  return normalize(query).split(" ").filter((t) => t.length > 0);
}

interface Scored { entry: CatalogEntry; score: number }

function fieldHas(field: string, squashed: string, tok: string): boolean {
  return field.includes(tok) || squashed.includes(tok);
}

/**
 * Score d'une entrée pour une requête : TOUS les mots doivent se retrouver (titre, mots-clés, résumé, texte) ; titre ×6, mots-clés ×4, résumé ×2, parcours ×1, texte ×1 ;
 * un mot en début de mot du titre ajoute 2. Retourne 0 si un mot manque.
 */
export function scoreEntry(e: CatalogEntry, toks: string[]): number {
  if (toks.length === 0) return 1;
  const title = normalize(e.title), tSq = squash(e.title);
  const kw = normalize((e.keywords ?? []).join(" ")), kSq = squash((e.keywords ?? []).join(" "));
  const sum = normalize(e.summary), sSq = squash(e.summary);
  const pth = normalize(PATH_LABEL[e.path]), pSq = squash(PATH_LABEL[e.path]);
  const body = e.body ? normalize(e.body) : "", bSq = e.body ? squash(e.body) : "";
  let total = 0;
  for (const tok of toks) {
    let s = 0;
    if (fieldHas(title, tSq, tok)) s += 6 + (title.split(" ").some((w) => w.startsWith(tok)) ? 2 : 0);
    if (fieldHas(kw, kSq, tok)) s += 4;
    if (fieldHas(sum, sSq, tok)) s += 2;
    if (fieldHas(pth, pSq, tok)) s += 1;
    if (body && fieldHas(body, bSq, tok)) s += 1;
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

export interface Filters { query?: string; depth?: Depth | null; kind?: Kind | null }

/** Entrées filtrées. Sans requête : ordre du catalogue ; avec requête : par score décroissant puis ordre du catalogue (stable). */
export function searchCatalog(entries: CatalogEntry[], f: Filters = {}): CatalogEntry[] {
  const toks = tokens(f.query ?? "");
  const scored: Scored[] = [];
  entries.forEach((entry) => {
    if (f.depth && entry.depth !== f.depth) return;
    if (f.kind && entry.kind !== f.kind) return;
    const score = scoreEntry(entry, toks);
    if (score > 0) scored.push({ entry, score });
  });
  if (toks.length > 0) scored.sort((a, b) => b.score - a.score);   // Array.prototype.sort est stable : l'ordre du catalogue départage les égalités
  return scored.map((s) => s.entry);
}

/** Compte par profondeur et par type, pour afficher « (n) » sur les filtres compte tenu de la requête (mais sans l'autre filtre de la même famille). */
export function facetCounts(entries: CatalogEntry[], f: Filters): { depth: Record<Depth, number>; kind: Record<Kind, number> } {
  const depth = { decouvrir: 0, pratiquer: 0, comprendre: 0 } as Record<Depth, number>;
  const kind = { guide: 0, concept: 0, depannage: 0, reference: 0, etat: 0 } as Record<Kind, number>;
  for (const e of searchCatalog(entries, { query: f.query, kind: f.kind })) depth[e.depth]++;
  for (const e of searchCatalog(entries, { query: f.query, depth: f.depth })) kind[e.kind]++;
  return { depth, kind };
}

// ── Anciennes ancres → parcours (liens existants, favoris, documents) ────────────
const INSTALL_HASHES = new Set(["installer", "material", "wiring", "arduino-ide", "esp-boards", "libraries", "firmware", "configure", "onboard", "draw"]);
const NETWORK_HASHES = new Set(["reseau", "how", "roles", "consensus", "why", "licence"]);

/** Parcours qui porte une ancre `#hash` lorsque l'adresse n'indique pas de `?path=` (ancien format). null = ancre inconnue (on ne redirige pas). */
export function pathForHash(hash: string): LearnPath | null {
  const h = hash.replace(/^#/, "");
  if (!h) return null;
  if (INSTALL_HASHES.has(h) || /^install-step-\d$/.test(h) || h.startsWith("i-")) return "install";
  if (h === "no-esp" || h === "sans-esp") return "no-esp";
  if (NETWORK_HASHES.has(h) || h.startsWith("n-")) return "network";
  if (h === "consommation" || h.startsWith("p-")) return "power";
  if (h === "synthese" || h.startsWith("synth-")) return "synthesis";
  if (h === "depannage" || h === "aide" || h.startsWith("h-")) return "help";
  if (h === "feuille-de-route" || h.startsWith("road-")) return "roadmap";
  if (h === "compatibilite" || h === "matrice" || h.startsWith("c-")) return "compat";
  return null;
}

export function parsePath(value: string | string[] | undefined): LearnPath | null {
  const p = Array.isArray(value) ? value[0] : value;
  return (LEARN_PATHS as string[]).includes(p ?? "") ? (p as LearnPath) : null;
}

// ── Documents markdown : sections cherchables et ancres de titres ───────────────
export interface MdBlock { kind: string; level?: number; text?: string; items?: string[]; lines?: string[]; head?: string[]; rows?: string[][] }

export function slugify(text: string, prefix: string): string {
  const base = normalize(text).replace(/ /g, "-").slice(0, 60).replace(/-+$/, "");
  return `${prefix}${base || "section"}`;
}

/** Identifiant stable de chaque titre de niveau 2 et 3 (null pour les autres blocs) ; les doublons reçoivent -2, -3… */
export function headingIds(blocks: MdBlock[], prefix: string): (string | null)[] {
  const seen = new Map<string, number>();
  return blocks.map((b) => {
    if (b.kind !== "h" || (b.level !== 2 && b.level !== 3) || !b.text) return null;
    const base = slugify(b.text, prefix), n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

/** Coupe à une frontière de mot avec « … » ; texte court inchangé. */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max), sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.(—-]+$/, "")}…`;
}

const stripMd = (s: string) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_>]/g, "");

/** Une entrée par titre de niveau 2 : résumé = premier paragraphe, texte intégral = tout ce qui suit jusqu'au titre suivant. */
export function sectionsFromBlocks(blocks: MdBlock[], opts: { prefix: string; path: LearnPath; kind: Kind; depth: Depth; keywords?: string[] }): CatalogEntry[] {
  const ids = headingIds(blocks, opts.prefix);
  const out: CatalogEntry[] = [];
  blocks.forEach((b, i) => {
    if (b.kind !== "h" || b.level !== 2 || !b.text || !ids[i]) return;
    const parts: string[] = [];
    let first = "", firstList = "";
    for (let j = i + 1; j < blocks.length && !(blocks[j].kind === "h" && (blocks[j].level ?? 9) <= 2); j++) {
      const x = blocks[j];
      const text = x.kind === "p" ? x.text ?? "" : x.kind === "ul" || x.kind === "ol" ? (x.items ?? []).join(" ") : x.kind === "quote" ? (x.lines ?? []).join(" ")
        : x.kind === "table" ? [...(x.head ?? []), ...(x.rows ?? []).flat()].join(" ") : x.kind === "h" ? x.text ?? "" : "";
      if (!text) continue;
      const clean = stripMd(text);
      if (!first && x.kind === "p") first = clean;
      if (!firstList && (x.kind === "ul" || x.kind === "ol") && x.items?.length) firstList = stripMd(x.items[0]);
      parts.push(clean);
    }
    // résumé : premier paragraphe, sinon premier élément de liste ; jamais le contenu brut d'un tableau
    const summary = shorten(first || firstList || "Section de référence (tableau ou liste).", 190);
    out.push({ id: ids[i] as string, title: stripMd(b.text), summary, kind: opts.kind, depth: opts.depth, path: opts.path, anchor: ids[i] as string, keywords: opts.keywords, body: parts.join(" ").slice(0, 4000) });
  });
  return out;
}
