// lib/missedWorks.ts
// Œuvres manquées par un écran (04/11/2026). Une frame validée n'est écrite que pour ~42 min (TTL = durée d'affichage, 15 min – 2 h) : un écran hors ligne
// à ce moment-là ne la reçoit jamais et ne se rattrape pas seul (voulu : pas de rafale au retour du Wi-Fi). Ce module décide, de façon PURE et testée,
// quels blocs récents CET écran aurait dû recevoir et n'a pas affichés ; le bouton « Rattraper » du profil réaffiche l'un d'eux avec /api/send-to-screen
// (frame personnelle, 7 jours — aucune règle de quorum, d'écran ni de format contournée).

export interface MissedBlockLike {
  blockHash: string;
  blockIndex: number;
  poolScreen: string;
  kind?: string;
  workTitle?: string;
  minedAt?: number;
  drawArtistName?: string;
  artistName?: string;
}

export interface MissedWork {
  blockHash: string;
  blockIndex: number;
  kind: "drawing" | "animation";
  title: string | null;
  artist: string | null;
  minedAt: number | null;
}

export interface MissedRules {
  screen: string;
  /** Numéro du dernier bloc CONFIRMÉ affiché par cet écran ; null = jamais confirmé (tout le récent compte, borné par `limit`). */
  lastShownIndex: number | null;
  /** Le firmware de cet écran lit les animations (lib/anim/pointer.ts : animCapable). */
  animCapable: boolean;
  /** Cet écran affiche les œuvres fixes (lib/fixedWorks.ts : showsFixedWorks). */
  showsFixed: boolean;
  /** Cet écran accepte les dessins convertis venant d'autres types d'écran (lib/deviceStore.ts : convertedScreensOf). */
  acceptsConverted: boolean;
  limit?: number;
}

const DEFAULT_LIMIT = 5;

/** Blocs (récents d'abord) que cet écran aurait dû recevoir et n'a pas affichés. */
export function pickMissedWorks(blocks: readonly (MissedBlockLike | null)[], rules: MissedRules): MissedWork[] {
  const out: MissedWork[] = [];
  const limit = rules.limit ?? DEFAULT_LIMIT;
  const sorted = blocks.filter((b): b is MissedBlockLike => !!b && Number.isFinite(b.blockIndex)).sort((a, b) => b.blockIndex - a.blockIndex);
  for (const b of sorted) {
    if (rules.lastShownIndex !== null && b.blockIndex <= rules.lastShownIndex) break;   // du plus récent au plus ancien : tout le reste est déjà passé
    const isAnim = b.kind === "animation";
    let eligible: boolean;
    if (isAnim) eligible = rules.animCapable;                                            // animation : jamais sur un e-ink ni un firmware qui ne la lit pas
    else if (!rules.showsFixed) eligible = false;                                        // écran dynamique réglé « animations seulement »
    else eligible = b.poolScreen === rules.screen || rules.acceptsConverted;
    if (!eligible) continue;
    out.push({
      blockHash: b.blockHash,
      blockIndex: b.blockIndex,
      kind: isAnim ? "animation" : "drawing",
      title: b.workTitle?.trim() || null,
      artist: (b.drawArtistName ?? b.artistName)?.trim() || null,
      minedAt: typeof b.minedAt === "number" ? b.minedAt : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}
