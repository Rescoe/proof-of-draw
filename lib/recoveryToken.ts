// lib/recoveryToken.ts
// Jeton de récupération d'accès à un PROFIL (04/11/2026). Problème résolu : la liaison téléphone ↔ ESP ne vivait que dans un cookie ; cookie perdu
// (Safari qui purge, navigation privée, navigateur intégré, nouveau téléphone) = « aucun écran », sans moyen de revenir (le code d'appairage
// n'est plus affiché une fois l'ESP appairé). Ce jeton, copiable dans une note / un message à soi-même, rétablit l'accès sans rien d'autre.
//
//   r1.<artistId en base64url>.<epoch>.<signature HMAC-SHA256 tronquée à 22 car.>
//
// • Signé (HMAC, secret du serveur, préfixe de domaine « pod-recovery-v1 » : un cookie de session ne peut pas passer pour un jeton) ;
//   rien n'est stocké côté serveur pour le valider, hormis l'`epoch` du profil (0 par défaut) : incrémenter l'epoch RÉVOQUE tous les jetons émis.
// • Module PUR : le secret est passé par l'appelant, l'aléa n'est pas utilisé (le jeton est dérivé de l'identifiant du profil).

export const RECOVERY_PREFIX = "r1";
const DOMAIN = "pod-recovery-v1";
const SIG_LEN = 22;
const ARTIST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

async function hmacB64(secret: string, data: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Buffer.from(sig).toString("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signRecoveryToken(artistId: string, epoch: number, secret: string): Promise<string> {
  if (!ARTIST_ID_RE.test(artistId)) throw new Error("artistId invalide");
  if (!Number.isInteger(epoch) || epoch < 0 || epoch > 1_000_000) throw new Error("epoch invalide");
  const sig = (await hmacB64(secret, `${DOMAIN}:${artistId}:${epoch}`)).slice(0, SIG_LEN);
  return `${RECOVERY_PREFIX}.${Buffer.from(artistId).toString("base64url")}.${epoch}.${sig}`;
}

export interface ParsedRecoveryToken { artistId: string; epoch: number }

/** Extrait le jeton d'une saisie : jeton nu, ou lien « …/retrouver#k=<jeton> » collé tel quel. Espaces et retours ignorés. */
export function extractRecoveryToken(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s.length === 0 || s.length > 400) return null;
  const fromLink = /[#?&]k=([A-Za-z0-9._-]+)/.exec(s);
  const candidate = (fromLink ? fromLink[1] : s).replace(/\s+/g, "");
  return /^r1\.[A-Za-z0-9_-]+\.\d{1,7}\.[A-Za-z0-9_-]{22}$/.test(candidate) ? candidate : null;
}

/** Vérifie la signature ; l'`epoch` courant du profil reste à comparer par l'appelant (révocation). */
export async function parseRecoveryToken(input: unknown, secret: string): Promise<ParsedRecoveryToken | null> {
  const token = extractRecoveryToken(input);
  if (!token) return null;
  const [, idB64, epochStr, sig] = token.split(".");
  let artistId: string;
  try { artistId = Buffer.from(idB64, "base64url").toString("utf8"); } catch { return null; }
  if (!ARTIST_ID_RE.test(artistId)) return null;
  const epoch = Number(epochStr);
  if (!Number.isInteger(epoch) || epoch < 0) return null;
  const expected = (await hmacB64(secret, `${DOMAIN}:${artistId}:${epoch}`)).slice(0, SIG_LEN);
  return constantTimeEqual(expected, sig) ? { artistId, epoch } : null;
}
