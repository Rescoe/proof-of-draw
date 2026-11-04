// lib/bootReport.ts
// Rapport de démarrage d'un appareil (04/11/2026), envoyé au /api/register par un firmware doté du « témoin de vie » (POD_LIVENESS) :
//   rr = cause du dernier reset (ESP.getResetInfoPtr()->reason : 0 mise sous tension, 1 chien de garde matériel, 2 exception, 3 chien de garde logiciel, 4 redémarrage logiciel, 5 réveil, 6 reset externe) ;
//   rp = dernière étape en cours AVANT l'arrêt (0 = aucune) ; rh = 1 si le témoin de vie a lui-même redémarré la carte parce que cette étape ne finissait pas.
// Pourquoi : une carte figée (sans redémarrage visible) ne dit rien côté serveur ; au redémarrage suivant elle dit enfin OÙ elle s'était arrêtée. Texte du journal d'appareil uniquement : aucune donnée n'est stockée à part.
// Module PUR (testé). Entrées non fiables : chaque champ est borné, jamais de texte libre.

export const BOOT_RESET_NAMES: Record<number, string> = { 0: "mise sous tension", 1: "chien de garde matériel", 2: "exception", 3: "chien de garde logiciel", 4: "redémarrage logiciel", 5: "réveil", 6: "reset externe" };
// Doit rester identique à l'énumération LivePhase du firmware (esp_eink_2.9BWR.ino).
export const BOOT_PHASE_NAMES: Record<number, string> = {
  1: "pull", 2: "lecture du candidat (validate-candidate)", 3: "lecture du contenu par morceaux (candidate-frame)", 4: "signature du vote", 5: "envoi du vote (validation-result)", 6: "réception et affichage d'une frame",
};

const int = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null);

/** Phrase du journal d'appareil, ou "" quand le corps ne porte aucun rapport (anciens firmwares). */
export function describeBoot(b: Record<string, unknown> | null | undefined): string {
  if (!b) return "";
  const rr = int(b.rr, 99), rp = int(b.rp, 99), rh = b.rh === 1 ? 1 : 0;
  const parts: string[] = [];
  if (rr !== null) parts.push(`reset : ${BOOT_RESET_NAMES[rr] ?? `cause ${rr}`}`);
  if (rp !== null && rp > 0) parts.push(`${rh ? "BLOQUÉ" : "interrompu"} pendant : ${BOOT_PHASE_NAMES[rp] ?? `étape ${rp}`}`);
  else if (rh) parts.push("blocage détecté (étape inconnue)");
  return parts.join(", ");
}
