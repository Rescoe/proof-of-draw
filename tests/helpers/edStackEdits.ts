// tests/helpers/edStackEdits.ts — LOT8B2B2-CANARY-R4-STACK-FIX1 : table EXACTE des modifications apportées aux cinq sketches UNO R4 pour faire passer Ed25519 par podEdStack.h (pile dédiée).
// Sert à (1) appliquer les modifications (scripts/apply-ed-stack.ts, une fois), (2) les ANNULER dans les tests : « sketch actuel, modifications annulées » doit être IDENTIQUE, au texte près,
// au sketch sauvegardé dans firmware-backups/2026-10-08_avant-correctif-pile-ed25519-r4/ — preuve que RIEN d'autre n'a changé (chemin stable, rendu v1, ACK, routes). Les anciens contrôles
// du lot 8B (vue POD_RENDER_V1 = 0 == firmware d'avant) s'appliquent alors au texte annulé.
export interface EdEdit { id: string; old: string; neu: string }

export const ED_EDITS: EdEdit[] = [
  { id: "include", old: `#include <Ed25519.h>\n`,
    neu: `#include <Ed25519.h>\n#include "podEdStack.h"   // POD_ED_STACK : Ed25519 sur PILE DÉDIÉE (la pile principale de la R4 n'a que 1 024 o) — docs/LOT_8B2B2_PILE_ED25519_R4_2026_10_08.md\n` },
  { id: "loadKeys", old: `  Ed25519::derivePublicKey(derived, privateKey);\n  if (memcmp(derived, publicKey, 32) != 0) {`,
    neu: `  if (!PodEd::derivePublicKey(derived, privateKey)) logf("[KEYS] cohérence NON vérifiée : calcul Ed25519 impossible (pile dédiée) — clé publique de l'EEPROM conservée");   // POD_ED_STACK\n  else if (memcmp(derived, publicKey, 32) != 0) {` },
  { id: "generateKeys", old: `  Ed25519::derivePublicKey(publicKey, privateKey);\n  keysLoaded = true;`,
    neu: `  if (!PodEd::derivePublicKey(publicKey, privateKey)) { logf("[KEYS] génération ANNULÉE : calcul Ed25519 impossible (pile dédiée) — aucune clé enregistrée"); memset(privateKey, 0, 32); return; }   // POD_ED_STACK\n  keysLoaded = true;` },
  { id: "signV1", old: `  Ed25519::sign(sig, privateKey, publicKey, (const uint8_t*)message.c_str(), message.length());\n  return bytesToHex(sig, 64);`,
    neu: `  if (!PodEd::sign(sig, privateKey, publicKey, (const uint8_t*)message.c_str(), message.length())) { logf("[VOTE] signature impossible (pile Ed25519 dédiée) — vote NON envoyé"); return String(); }   // POD_ED_STACK\n  return bytesToHex(sig, 64);` },
  { id: "callV1", old: `  const String signature = signED25519(candidateId, score);\n`,
    neu: `  const String signature = signED25519(candidateId, score);\n  if (signature.length() == 0) { pendingCandidateId = ""; return false; }   // POD_ED_STACK : signature impossible → pas de vote\n` },
  { id: "signV2", old: `Ed25519::sign(sig, privateKey, publicKey, (const uint8_t*)msg.c_str(), msg.length());`,
    neu: `if (!PodEd::sign(sig, privateKey, publicKey, (const uint8_t*)msg.c_str(), msg.length())) { logf("[VALIDATE2] signature impossible (pile Ed25519 dédiée) — vote NON envoyé"); return false; }   // POD_ED_STACK` },
  { id: "selfSign", old: `  Ed25519::sign(sig, privateKey, publicKey, msg, strlen(msg));`,
    neu: `  PodEdInfo infoS, infoV; memset(&infoV, 0, sizeof(infoV));   // POD_ED_STACK\n  const bool signedOk = PodEd::sign(sig, privateKey, publicKey, msg, strlen(msg), &infoS);` },
  { id: "selfVerify", old: `  const bool ok = Ed25519::verify(sig, publicKey, msg, strlen(msg));`,
    neu: `  const bool ok = signedOk && PodEd::verify(sig, publicKey, msg, strlen(msg), &infoV);   // POD_ED_STACK` },
  { id: "selfLog", old: `  reportMem("après Ed25519");`,
    neu: `  reportMem("après Ed25519");\n  logf("[ED25519] pile dédiée (utilisé/marge, o) : sign %u/%u, verify %u/%u ; erreurs sign=%u verify=%u (0 = aucune) ; alloué %u o (garde %u o, marge minimale exigée %u o)", (unsigned)infoS.used, (unsigned)infoS.margin, (unsigned)infoV.used, (unsigned)infoV.margin, (unsigned)infoS.err, (unsigned)infoV.err, (unsigned)POD_ED_STACK_TOTAL, (unsigned)POD_ED_GUARD_BYTES, (unsigned)POD_ED_MARGIN_MIN);   // POD_ED_STACK` },
];

/** Modifications propres à un sketch (commentaires devenus faux). */
export const ED_EXTRA: Record<string, EdEdit[]> = {
  "pod_uno_r4": [
    { id: "commentStack", old: `// le tas est peu rempli). Ed25519 a besoin d'environ 1,7 Ko : ça tient parce que le tas est presque vide à ce moment-là.`,
      neu: `// le tas est peu rempli). Ed25519 a besoin d'environ 1,4 Ko : il s'exécute désormais sur une PILE DÉDIÉE (podEdStack.h), plus dans le haut du tas (POD_ED_STACK).` },
    { id: "commentSelf", old: `prouve que signature + vérification passent dans 1 Ko de pile + marge du tas`, neu: `signature + vérification sur la pile dédiée (podEdStack.h), garde et marge mesurées (POD_ED_STACK)` },
  ],
};

export const ED_SKETCHES = ["pod_uno_r4_eink29", "pod_uno_r4_eink27", "pod_uno_r4_eink27_oled", "pod_uno_r4_tft18", "pod_uno_r4"] as const;

export const editsFor = (sketch: string): EdEdit[] => [...ED_EDITS, ...(ED_EXTRA[sketch] ?? [])];

const count = (t: string, s: string) => t.split(s).length - 1;

/** Applique les modifications (chacune exactement une fois). Fin de ligne CRLF conservée. */
export function applyEdStack(src: string, sketch: string): string {
  const crlf = src.includes("\r\n");
  let t = src.replace(/\r\n/g, "\n");
  for (const e of editsFor(sketch)) {
    if (count(t, e.old) !== 1) throw new Error(`${sketch} : « ${e.id} » doit apparaître exactement une fois (trouvé ${count(t, e.old)})`);
    t = t.split(e.old).join(e.neu);
  }
  return crlf ? t.replace(/\n/g, "\r\n") : t;
}

/** Annule les modifications. Lève si l'une d'elles n'apparaît pas exactement une fois (le texte a été touché autrement). */
export function undoEdStack(src: string, sketch: string): string {
  let t = src.replace(/\r\n/g, "\n");
  for (const e of [...editsFor(sketch)].reverse()) {
    if (count(t, e.neu) !== 1) throw new Error(`${sketch} : modification « ${e.id} » absente ou en double (${count(t, e.neu)})`);
    t = t.split(e.neu).join(e.old);
  }
  return t;
}
