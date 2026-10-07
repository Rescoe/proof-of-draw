// lib/clipTicket.ts — TICKET HMAC de GET /api/candidate-clip (Lot 6B-2, docs/SPEC_PODANIM_V3.md § 7, décision A9). Pur (aucun Redis, aucun réseau).
//
// Pourquoi : la route peut être appelée DIRECTEMENT, sans passer par `validate-candidate` : son coût Redis ne peut donc pas s'appuyer sur le rate-limit de celui-ci. Le ticket
//   t = HMAC-SHA256( secret serveur, "candidate-clip-v1|" candidateId "|" exp )
// est COMMUN à tous les validateurs d'un candidat (même URL ⇒ une seule entrée de cache CDN par région), calculé SANS Redis (le serveur connaît `candidateId` et `expiresAt`) et vérifié AVANT toute
// lecture Redis, en temps constant. `exp` = Math.floor(candidate.expiresAt / 1000) : UNE SEULE expiration, dérivée du candidat. Le ticket n'authentifie PAS un appareil : un ticket divulgué
// permet de demander le clip jusqu'à `exp` (le contenu est public après le bloc) ; la réponse 200 est immuable, le CDN absorbe les répétitions.
// Secret : variable CLIP_TICKET_SECRET (≥ 32 caractères aléatoires, JAMAIS dans le dépôt ni dans les journaux) ; absente ou trop courte ⇒ route inactive et AUCUN ticket émis.

import { createHmac, timingSafeEqual } from "node:crypto";

export const CLIP_TICKET_DOMAIN = "candidate-clip-v1";
export const CLIP_TICKET_MIN_SECRET = 32;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const EXP_RE = /^[1-9]\d{0,11}$/;

export const clipTicketSecret = (env: NodeJS.ProcessEnv = process.env): string | null => {
  const s = env.CLIP_TICKET_SECRET;
  return typeof s === "string" && s.length >= CLIP_TICKET_MIN_SECRET ? s : null;
};

/** Expiration UNIQUE du ticket : secondes Unix, dérivée de `candidate.expiresAt` (ms). */
export const clipTicketExp = (expiresAtMs: number): number => Math.floor(expiresAtMs / 1000);

export function clipTicket(secret: string, candidateId: string, exp: number): string {
  if (secret.length < CLIP_TICKET_MIN_SECRET) throw new Error("secret de ticket trop court");
  if (!UUID_RE.test(candidateId) || !Number.isInteger(exp) || exp <= 0) throw new Error("paramètres de ticket invalides");
  return createHmac("sha256", secret).update(`${CLIP_TICKET_DOMAIN}|${candidateId}|${exp}`).digest("hex");
}

/** Vérification en TEMPS CONSTANT ; ne lève jamais. Aucun accès Redis. */
export function verifyClipTicket(secret: string, candidateId: string, exp: number, t: string): boolean {
  try {
    if (!HEX64.test(t)) return false;
    return timingSafeEqual(Buffer.from(clipTicket(secret, candidateId, exp), "hex"), Buffer.from(t, "hex"));
  } catch { return false; }
}

/** URL relative complète (la SEULE forme acceptée par la route : paramètres dans cet ordre). */
export const clipUrl = (candidateId: string, exp: number, t: string): string => `/api/candidate-clip?candidateId=${candidateId}&exp=${exp}&t=${t}`;

/** Pointeur d'un candidat (≈ 190 octets) — PURE, JAMAIS appelée par une route de distribution dans ce lot : aucun ticket n'est remis aux firmwares actuels. */
export function clipPointer(secret: string, candidate: { candidateId: string; expiresAt: number }): { url: string; exp: number } {
  const exp = clipTicketExp(candidate.expiresAt);
  return { url: clipUrl(candidate.candidateId, exp, clipTicket(secret, candidate.candidateId, exp)), exp };
}

export type ClipQuery = { ok: true; candidateId: string; exp: number; t: string } | { ok: false; error: string };

/**
 * Lecture STRICTE de la requête, AVANT tout accès Redis : exactement les trois paramètres `candidateId`, `exp`, `t`, chacun UNE fois, formats stricts, et chaîne de requête BRUTE canonique
 * (même ordre, aucun encodage superflu, aucun paramètre en plus) — sinon on contournerait le cache CDN (une URL différente = un défaut de cache = une lecture Redis).
 */
export function parseClipQuery(rawSearch: string): ClipQuery {
  if (typeof rawSearch !== "string" || rawSearch.length === 0 || rawSearch.length > 200) return { ok: false, error: "requête invalide" };
  const m = /^\?candidateId=([0-9a-f-]{36})&exp=(\d{1,12})&t=([0-9a-f]{64})$/.exec(rawSearch);
  if (!m) return { ok: false, error: "paramètres : exactement candidateId, exp, t, dans cet ordre" };
  const [, candidateId, expStr, t] = m;
  if (!UUID_RE.test(candidateId)) return { ok: false, error: "candidateId invalide" };
  if (!EXP_RE.test(expStr)) return { ok: false, error: "exp invalide" };
  return { ok: true, candidateId, exp: Number(expStr), t };
}
