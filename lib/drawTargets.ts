// lib/drawTargets.ts — choix de l'écran sur lequel dessiner (page /draw). Logique PURE, testée : aucune requête ici.
// Sépare « mes écrans » (appareils de ma session / de mon profil) des « écrans partagés » (prêt public d'AUTRES artistes),
// et distingue explicitement chargement / vide / erreur : un échec d'API n'est jamais présenté comme une liste vide.

import { SCREEN_PROFILES, isValidScreenId, type ScreenId } from "./screenProfiles";

export interface OwnedLike { deviceId: string; artistName?: string; deviceName?: string; screens?: string[]; isOnline?: boolean }
export interface PublicLike { deviceId: string; artistName?: string; screens?: string[]; isOnline?: boolean }

export interface DrawTarget {
  deviceId: string;
  /** Nom affiché : nom donné à l'appareil, sinon nom d'artiste, sinon identifiant. */
  label: string;
  online: boolean;
  /** Écrans réellement dessinables (pseudo-écran « sensor » et écrans inconnus exclus). */
  screens: { id: ScreenId; name: string }[];
}

export type LoadState<T> =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };

/** Écrans dessinables d'un appareil : profils connus seulement, sans doublon, ordre conservé. */
export function drawableScreens(screens: unknown): { id: ScreenId; name: string }[] {
  if (!Array.isArray(screens)) return [];
  const seen = new Set<string>();
  const out: { id: ScreenId; name: string }[] = [];
  for (const s of screens) {
    if (typeof s !== "string" || seen.has(s) || !isValidScreenId(s)) continue;
    seen.add(s);
    out.push({ id: s, name: SCREEN_PROFILES[s].name });
  }
  return out;
}

function toTarget(d: OwnedLike | PublicLike, label: string): DrawTarget | null {
  const screens = drawableScreens(d.screens);
  if (!d.deviceId || screens.length === 0) return null;   // capteur seul, ou aucun écran connu : rien à dessiner
  return { deviceId: d.deviceId, label, online: d.isOnline === true, screens };
}

/** Mes écrans : en ligne d'abord, puis par nom. */
export function mineTargets(owned: OwnedLike[]): DrawTarget[] {
  return owned
    .map((d) => toTarget(d, d.deviceName?.trim() || d.artistName?.trim() || d.deviceId))
    .filter((t): t is DrawTarget => t !== null)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.label.localeCompare(b.label, "fr"));
}

/** Écrans partagés par d'autres : ceux que je possède déjà sont retirés (ils sont dans « mes écrans »). */
export function sharedTargets(pub: PublicLike[], ownedIds: Iterable<string>): DrawTarget[] {
  const mine = new Set(ownedIds);
  return pub
    .filter((p) => !mine.has(p.deviceId))
    .map((p) => toTarget(p, p.artistName?.trim() || "Artiste inconnu"))
    .filter((t): t is DrawTarget => t !== null)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.label.localeCompare(b.label, "fr"));
}

/**
 * Transforme le résultat d'un fetch de liste en état d'interface. `ok` faux, corps illisible ou champ absent = ERREUR (jamais « vide »).
 * Un tableau présent mais vide est un vrai vide.
 */
export function classifyList<T>(ok: boolean, status: number, body: unknown, field: string): LoadState<T[]> {
  if (!ok) return { kind: "error", message: status === 429 ? "Trop de requêtes : réessaie dans un instant." : `Le serveur a répondu avec une erreur (${status}).` };
  const list = body && typeof body === "object" ? (body as Record<string, unknown>)[field] : undefined;
  if (!Array.isArray(list)) return { kind: "error", message: "Réponse du serveur inattendue." };
  return { kind: "ready", data: list as T[] };
}

export const NETWORK_ERROR_MESSAGE = "Connexion impossible : vérifie ton réseau puis réessaie.";
