// lib/deviceDeleteGuard.ts — garde-fou de la suppression d'un ESP (page « Mon profil »).
// Supprimer un appareil est irréversible : l'utilisateur doit RETAPER le nom de l'appareil (à défaut son identifiant).
// Comparaison tolérante (casse, accents, espaces multiples) mais jamais vide : un nom vide ne valide rien.

const norm = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

interface DeviceLike { deviceId: string; deviceName?: string; artistName?: string }

/** Le mot à retaper : nom de l'appareil, sinon nom d'artiste, sinon identifiant. */
export function deleteConfirmWord(d: DeviceLike): string {
  return d.deviceName?.trim() || d.artistName?.trim() || d.deviceId;
}

/** Vrai seulement si `input` correspond au mot attendu. */
export function deleteConfirmed(input: string, d: DeviceLike): boolean {
  const expected = norm(deleteConfirmWord(d));
  return expected.length > 0 && norm(input) === expected;
}
