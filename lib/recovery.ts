// lib/recovery.ts
// Récupération d'accès à un profil (04/11/2026) — partie serveur. Format et signature : lib/recoveryToken.ts.
// Redis : `artist:recepoch:{artistId}` (entier, sans TTL, absent = 0) ; rien d'autre n'est stocké pour valider un jeton.
// Coût : lecture/émission du jeton = 1 MGET (profil + epoch) ; récupération = 1 MGET ; révocation = 1 INCR. Aucune écriture en usage normal.

import { redis } from "@/lib/redis";
import type { ArtistProfile } from "@/lib/deviceStore";
import { sessionSecret } from "@/lib/session";
import { parseRecoveryToken, signRecoveryToken } from "@/lib/recoveryToken";

export const recoveryEpochKey = (artistId: string) => `artist:recepoch:${artistId}`;

async function readProfileAndEpoch(artistId: string): Promise<{ profile: ArtistProfile | null; epoch: number }> {
  const [rawProfile, rawEpoch] = await redis.mget<unknown[]>(`artist:${artistId}`, recoveryEpochKey(artistId));
  let profile: ArtistProfile | null = null;
  if (rawProfile) { try { profile = typeof rawProfile === "string" ? JSON.parse(rawProfile) : (rawProfile as ArtistProfile); } catch { profile = null; } }
  const epoch = Number(rawEpoch ?? 0);
  return { profile, epoch: Number.isInteger(epoch) && epoch >= 0 ? epoch : 0 };
}

/** Jeton courant d'un profil existant (null si le profil n'existe pas). */
export async function currentRecoveryToken(artistId: string): Promise<string | null> {
  const { profile, epoch } = await readProfileAndEpoch(artistId);
  return profile ? signRecoveryToken(artistId, epoch, sessionSecret()) : null;
}

/** Révoque tous les jetons émis (epoch + 1) et renvoie le nouveau. */
export async function rotateRecoveryToken(artistId: string): Promise<string | null> {
  const { profile } = await readProfileAndEpoch(artistId);
  if (!profile) return null;
  const epoch = await redis.incr(recoveryEpochKey(artistId));
  return signRecoveryToken(artistId, epoch, sessionSecret());
}

/** Valide un jeton saisi : signature, profil encore existant, epoch non révoqué. */
export async function redeemRecoveryToken(input: unknown): Promise<ArtistProfile | null> {
  const parsed = await parseRecoveryToken(input, sessionSecret());
  if (!parsed) return null;
  const { profile, epoch } = await readProfileAndEpoch(parsed.artistId);
  if (!profile || epoch !== parsed.epoch) return null;
  return profile;
}
