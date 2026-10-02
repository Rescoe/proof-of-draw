// lib/linkCode.ts
// Code d'appairage d'un navigateur / PC à un profil (« XXXX-XXXX », 10 min, usage unique). Module PUR (testé).
// 32 caractères sans I/O/0/1 (illisibles) : 32^8 ≈ 1,1·10^12 combinaisons ; 256 est divisible par 32, donc
// `byte & 31` est strictement uniforme (aucun biais de modulo). L'aléa DOIT être cryptographique (pas Math.random).

export const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;

const cryptoRandom = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function generateLinkCode(random: (n: number) => Uint8Array = cryptoRandom): string {
  const bytes = random(LINK_CODE_LENGTH);
  const chars = Array.from(bytes, (b) => LINK_CODE_ALPHABET[b & 31]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Normalise une saisie utilisateur (minuscules, espaces, tiret absent) ; null si ce ne peut pas être un code. */
export function normalizeLinkCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const compact = input.toUpperCase().replace(/[\s-]+/g, "");
  if (compact.length !== LINK_CODE_LENGTH) return null;
  for (const ch of compact) if (!LINK_CODE_ALPHABET.includes(ch)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

export type LinkCodeStatus = "pending" | "used" | "expired";

/**
 * Droit de contrôler un ESP : le cookie le liste (appairage historique par onboarding), OU le cookie porte un profil
 * (artistId signé) auquel l'ESP est rattaché — même si l'ESP a été ajouté APRÈS l'appairage depuis un autre appareil.
 * `deviceArtistId` = profil auquel l'ESP est lié aujourd'hui (null s'il n'est lié à aucun) ; il disparaît donc d'un
 * profil dès que l'ESP en est détaché (don).
 */
export function canControlDevice(
  session: { deviceIds: string[]; artistId?: string },
  deviceId: string,
  deviceArtistId: string | null,
): boolean {
  if (session.deviceIds.includes(deviceId)) return true;
  return !!session.artistId && !!deviceArtistId && deviceArtistId === session.artistId;
}
