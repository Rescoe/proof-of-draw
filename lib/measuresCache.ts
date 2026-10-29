// lib/measuresCache.ts — cache de session des historiques de mesures (UX jalon 4, 29/10/2026) : PUR (aucun DOM, aucun fetch, horloge injectable), testé dans tests/measuresCache.test.ts.
// Règles (audit Codex) :
//  • une requête simultanée pour la même clé partage UNE Promise (deux composants qui ouvrent le même panneau = une seule lecture) ;
//  • la clé sépare strictement « own » (historique privé du propriétaire) et « pub » (historique public) : une réponse privée n'est JAMAIS servie à un appel public ;
//  • expiration mesurable (durée du cache CDN de /api/sensor?public=1 : 2 min) ; `invalidate` force une relecture ; un échec n'est jamais gardé ;
//  • aucun polling : le cache ne relit jamais de lui-même.

export const MEASURES_CACHE_TTL_MS = 2 * 60 * 1000;

/** Clé de cache : le périmètre (privé / public) est PARTIE de la clé. */
export const measuresKey = (deviceId: string, owner: boolean) => `${owner ? "own" : "pub"}:${deviceId}`;

export interface SharedCache<T> {
  /** Retourne la valeur en cache, la requête en cours, ou lance `loader` (une seule fois pour toutes les demandes simultanées). */
  get(key: string, loader: () => Promise<T>): Promise<T>;
  invalidate(key: string): void;
  clear(): void;
  has(key: string): boolean;
}

export function createSharedCache<T>(opts: { ttlMs?: number; now?: () => number } = {}): SharedCache<T> {
  const ttl = opts.ttlMs ?? MEASURES_CACHE_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const map = new Map<string, { promise: Promise<T>; at: number }>();
  return {
    get(key, loader) {
      const hit = map.get(key);
      if (hit && now() - hit.at < ttl) return hit.promise;
      const promise = loader();
      const entry = { promise, at: now() };
      map.set(key, entry);
      promise.catch(() => { if (map.get(key) === entry) map.delete(key); });   // un échec n'est jamais gardé : la demande suivante relit
      return promise;
    },
    invalidate(key) { map.delete(key); },
    clear() { map.clear(); },
    has(key) { const hit = map.get(key); return !!hit && now() - hit.at < ttl; },
  };
}
