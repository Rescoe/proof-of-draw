// lib/personalFrame.ts — quand une frame PERSONNELLE (dessin privé du propriétaire) doit-elle être annoncée à l'appareil par /api/pull ? (pur, sans Redis, testé)
//
// Problème observé le 14/10/2026 : l'ACK d'une frame personnelle ne la supprime pas (`cleared:false`) et l'appareil ne mémorise pas son dernier `frameId` au redémarrage. Après un Reset,
//   - un e-ink retéléchargeait et REPEIGNAIT la même frame personnelle (écran rafraîchi pour rien) ;
//   - si une frame du CONSENSUS avait été affichée entre-temps (sa clé supprimée par l'ACK), un ANCIEN dessin privé réapparaissait.
// Règle : pour un écran qui CONSERVE son image sans alimentation (e-ink), une frame personnelle déjà reçue (l'appareil a accusé réception APRÈS sa création) n'est plus annoncée.
//   Les écrans volatils (OLED, TFT) ne sont pas concernés : ils restaurent ou repeignent comme avant.
// Complément côté /api/ack-frame : l'ACK d'une frame du consensus supprime la frame personnelle devenue obsolète.

/** Écrans dont l'image reste affichée hors tension : un redémarrage n'a aucune raison de la repeindre. */
export const PERSISTENT_DISPLAY_SCREENS: readonly string[] = ["eink29bwr", "eink27bw"];

export function personalFrameAnnounced(
  personal: { createdAt?: number; payload?: { screen?: unknown } } | null | undefined,
  device: { lastFrameReceivedAt?: number; screens?: readonly string[] | null } | null | undefined,
): boolean {
  if (!personal || !personal.payload) return false;
  // MULTISCREEN-PERSONAL-FRAME-FIX1 : `lastFrameReceivedAt` est UN seul horodatage par appareil ; avec plusieurs écrans, l'accusé de l'un ne prouve rien pour l'autre => ancien comportement (toujours annoncée).
  if ((device?.screens?.length ?? 0) > 1) return true;
  const screen = typeof personal.payload.screen === "string" ? personal.payload.screen : "";
  if (!PERSISTENT_DISPLAY_SCREENS.includes(screen)) return true;
  if (typeof personal.createdAt !== "number") return true;
  return (device?.lastFrameReceivedAt ?? 0) < personal.createdAt;
}

/**
 * L'ACK d'une frame du consensus affichée sur `ackScreen` rend-il la frame personnelle OBSOLÈTE ? Seulement si elle vise le MÊME écran
 * (MULTISCREEN-PERSONAL-FRAME-FIX1 : un ACK OLED ne doit pas faire disparaître une frame personnelle e-ink jamais affichée). `personalRaw` = valeur Redis brute (chaîne JSON ou objet).
 */
export function personalFrameSupersededBy(personalRaw: unknown, ackScreen: string): boolean {
  if (personalRaw === null || personalRaw === undefined) return false;
  let p: { payload?: { screen?: unknown } } | null = null;
  try { p = typeof personalRaw === "string" ? JSON.parse(personalRaw) : (personalRaw as { payload?: { screen?: unknown } }); } catch { return false; }
  return !!p && typeof p.payload?.screen === "string" && p.payload.screen === ackScreen;
}
