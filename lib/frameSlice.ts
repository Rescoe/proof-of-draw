// lib/frameSlice.ts — téléchargement d'une frame binaire PAR MORCEAUX (24/10/2026).
// Pourquoi : le serveur n'accepte aucune taille de fragment TLS (MFLN refusé, mesuré), donc un ESP8266 qui lit une réponse de 9 472 o doit réserver 16 Ko de tampon de réception TLS
// (≈ 29 Ko de tas pendant la connexion). Avec des réponses de ≤ 4 Ko le même ESP8266 peut utiliser un tampon de 4 Ko : ≈ 18 Ko de tas, soit ≈ 12 Ko de marge en plus (mesuré sur la carte).
// Contrat : GET /api/pull-frame?deviceId=…&fmt=bin&off=<octet de début>&len=<longueur ≤ 4096> renvoie l'octet de début … début + len (borné à la fin) ; sans off ni len : réponse COMPLÈTE comme avant (firmwares déployés inchangés).
export const FRAME_SLICE_MAX = 4096;

export type FrameSlice = { ok: true; whole: boolean; off: number; end: number } | { ok: false; error: string };

export function parseFrameSlice(offRaw: string | null, lenRaw: string | null, total: number): FrameSlice {
  if (offRaw === null && lenRaw === null) return { ok: true, whole: true, off: 0, end: total };
  if (offRaw === null || lenRaw === null) return { ok: false, error: "off et len vont ensemble" };
  if (!/^\d{1,7}$/.test(offRaw) || !/^\d{1,5}$/.test(lenRaw)) return { ok: false, error: "off et len : entiers décimaux" };
  const off = Number(offRaw), len = Number(lenRaw);
  if (len < 1 || len > FRAME_SLICE_MAX) return { ok: false, error: `len : 1..${FRAME_SLICE_MAX}` };
  if (off >= total) return { ok: false, error: "off hors de la frame" };
  return { ok: true, whole: false, off, end: Math.min(total, off + len) };
}
