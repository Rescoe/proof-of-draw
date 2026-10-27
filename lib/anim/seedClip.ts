// lib/anim/seedClip.ts — point de départ de l'atelier d'animation : un clip PBC1 existant (animation rejetée ou bloc d'animation miné) devient un brouillon modifiable. Pur, testé.
// Le clip source n'est jamais modifié : l'atelier travaille sur une COPIE (images, délais, couleurs) ; l'envoi suit son propre parcours de validation.
import { decodeClip } from "@/lib/bench/clip";

export interface StudioClipSeed { frames: Uint8Array[]; delays: number[]; fg: string; bg: string; loops: number }

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
/** RVB565 → "#rrggbb" (bits hauts répétés dans les bits bas : 0xFFFF → #ffffff, 0 → #000000). */
export function rgb565ToHex(v: number): string {
  const r5 = (v >> 11) & 31, g6 = (v >> 5) & 63, b5 = v & 31;
  return `#${hex2((r5 << 3) | (r5 >> 2))}${hex2((g6 << 2) | (g6 >> 4))}${hex2((b5 << 3) | (b5 >> 2))}`;
}

export function clipToStudioSeed(bin: Uint8Array): StudioClipSeed {
  const c = decodeClip(bin);   // refuse tout clip altéré (CRC, structure)
  return { frames: c.frames.map((f) => Uint8Array.from(f)), delays: [...c.delaysMs], fg: rgb565ToHex(c.fg), bg: rgb565ToHex(c.bg), loops: c.loops };
}

export function clipB64ToStudioSeed(b64: string): StudioClipSeed {
  const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return clipToStudioSeed(bin);
}

export type ClipSeedRequest = { kind: "resume"; candidateId: string } | { kind: "remix"; blockHash: string };
/** Lit `?resume={candidat}` ou `?remix={bloc}` de l'adresse de l'atelier ; tout autre format = aucune demande. */
export function parseClipSeedRequest(search: string): ClipSeedRequest | null {
  const sp = new URLSearchParams(search);
  const remix = (sp.get("remix") ?? "").trim().toLowerCase();
  if (remix) return /^[a-f0-9]{64}$/.test(remix) ? { kind: "remix", blockHash: remix } : null;
  const resume = (sp.get("resume") ?? "").trim();
  return /^[0-9A-Za-z-]{8,64}$/.test(resume) ? { kind: "resume", candidateId: resume } : null;
}
