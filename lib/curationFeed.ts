// lib/curationFeed.ts — contrat PUBLIC « curation » v1 : œuvres de Proof of Draw lisibles par Néo-RESCOE (galerie curatée).
// Pur : ni Redis ni Next. Le contrat est documenté dans docs/API_CURATION_V1.md.
//
// Principes (ADR 0003 de Néo-RESCOE) : LECTURE SEULE, aucune donnée d'appareil ni d'identité technique (deviceId, validatorIds…), seulement ce
// que la galerie PoD montre déjà publiquement. Un refus de curation chez Néo ne supprime rien ici.

import type { Block } from "@/lib/chain";

export const CURATION_API_VERSION = 1;

export interface CurationCartel {
  /** Haut du cartel gravé sur l'écran : « 2026-11-19 · bloc #123 » */
  top: string;
  /** Bas du cartel : « Artiste — Titre » */
  bottom: string;
}

export interface CurationWork {
  /** Identifiant stable et unique : le hash du bloc (64 hex). */
  id: string;
  kind: "draw" | "animation";
  title: string;
  /** Artiste du dessin (l'artiste dessinateur si différent du propriétaire de l'écran). */
  artist: string;
  blockIndex: number;
  /** ISO 8601 UTC de minage. */
  minedAt: string;
  /** Profil d'écran du bloc (ex. « eink29bwr »), utile pour le format d'origine. */
  screen: string;
  /** Niveau de validation réellement atteint : approbations, refus. Absent sur les anciens blocs. */
  validation: { approvals: number; rejects: number } | null;
  cartel: CurationCartel;
  hashes: { block: string; image: string; actions: string };
  /** URLs relatives à l'origine de l'API, à résoudre par le client. */
  links: { page: string; image: string };
}

export interface CurationPage {
  version: number;
  works: CurationWork[];
  /** `blockIndex` à passer en `before` pour la page suivante ; null = fin. */
  next: number | null;
}

const DEFAULT_TITLE = "Sans titre";

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Cartel tel que gravé sur l'écran : date + n° de bloc en haut, artiste + titre en bas. */
export function buildCartel(artist: string, title: string, blockIndex: number, minedAt: number): CurationCartel {
  return { top: `${isoDay(minedAt)} · bloc #${blockIndex}`, bottom: `${artist} — ${title}` };
}

/** `null` pour un bloc qui ne doit pas être exposé (bloc ANA : index séparé, autre flux). */
export function toCurationWork(block: Block): CurationWork | null {
  if (block.source === "ana-agent") return null;
  if (!/^[0-9a-f]{64}$/i.test(block.blockHash)) return null;
  const title  = (block.workTitle ?? "").trim() || DEFAULT_TITLE;
  const artist = (block.drawArtistName ?? "").trim() || (block.artistName ?? "").trim() || "Anonyme";
  const s = block.votesSummary;
  return {
    id: block.blockHash,
    kind: block.kind === "animation" ? "animation" : "draw",
    title,
    artist,
    blockIndex: block.blockIndex,
    minedAt: new Date(block.minedAt).toISOString(),
    screen: block.poolScreen,
    validation: s ? { approvals: s.v2 + s.v1, rejects: s.rejects } : null,
    cartel: buildCartel(artist, title, block.blockIndex, block.minedAt),
    hashes: { block: block.blockHash, image: block.imageHash, actions: block.actionsHash },
    links: {
      // La galerie PoD n'a pas encore de lien direct par bloc : on renvoie à l'explorateur.
      page: `/gallery`,
      image: `/api/v1/curation/works/${block.blockHash}/image.svg`,
    },
  };
}

/** Pagination par `before` (blockIndex strictement inférieur), plus récent d'abord. */
export function pageWorks(blocks: Block[], opts: { before?: number | null; limit: number }): CurationPage {
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit) || 20));
  const sorted = blocks
    .filter((b) => opts.before == null || b.blockIndex < opts.before)
    .sort((a, b) => b.blockIndex - a.blockIndex);
  const works: CurationWork[] = [];
  let lastIndex: number | null = null;
  let consumed = 0;
  for (const b of sorted) {
    if (works.length >= limit) break;
    consumed++;
    lastIndex = b.blockIndex;
    const w = toCurationWork(b);
    if (w) works.push(w);
  }
  return { version: CURATION_API_VERSION, works, next: consumed < sorted.length ? lastIndex : null };
}
