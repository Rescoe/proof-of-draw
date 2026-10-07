// lib/animShadow.ts — mode « shadow » d'ANIM_V3_MODE (Lot 6B-2) : la RÉFÉRENCE v3 d'un candidat animation, calculée et JOURNALISÉE, sans AUCUN effet.
//
// Ce module ne fait qu'UNE chose : transformer le clip du candidat en une ligne de journal (framesRoot, animRoot, E/T/R/S, règle A1, affiche) afin de comparer, en conditions réelles, ce que les
// appareils futurs recalculeront et ce que le serveur sait déjà. Il n'écrit RIEN (ni Redis, ni le candidat), ne lève JAMAIS, ne change aucune décision (quorum, vote, bloc). Coût Redis : 0.
// Coût calcul : décodage d'au plus 9 216 octets et 64 images (≈ quelques ms).

import { analyzeClip } from "@/lib/animV3";
import type { Candidate } from "@/lib/chain";

export function animShadowLine(candidate: Pick<Candidate, "candidateId" | "anim">): string | null {
  if (!candidate.anim) return null;
  const id = candidate.candidateId.slice(0, 8);
  try {
    const bin = new Uint8Array(Buffer.from(candidate.anim.clip, "base64"));
    const a = analyzeClip(bin);
    if (!a.formatOk) return `[anim-v3] SHADOW candidate=${id} règle=format (${a.reason ?? "?"}) octets=${bin.length} clipHash=${a.clipHash.slice(0, 12)}`;
    return `[anim-v3] SHADOW candidate=${id} règle=${a.ruleCode} images=${a.N} E=${a.E} T=${a.T} R=${a.R} S=${a.S} affiche=${a.posterIndex} framesRoot=${a.framesRoot.slice(0, 12)} animRoot=${a.animRoot.slice(0, 12)} clipHash=${a.clipHash.slice(0, 12)} octets=${bin.length}`;
  } catch (e) {
    return `[anim-v3] SHADOW candidate=${id} erreur de calcul ignorée : ${e instanceof Error ? e.message : "inconnue"}`;
  }
}
