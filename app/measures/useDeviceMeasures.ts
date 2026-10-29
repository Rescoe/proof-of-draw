"use client";
// app/measures/useDeviceMeasures.ts — LECTURE UNIQUE de l'historique de mesures d'un appareil (UX jalon 4). Un seul GET /api/sensor par appareil et par ouverture, partagé par tous les
// composants qui le demandent (cache de session + Promise partagée : lib/measuresCache.ts). Aucun polling. Propriétaire : historique privé ; sinon historique public (404 = « indisponible »).
import { useCallback, useEffect, useState } from "react";
import { MEASURE_MAX_HOURS, type Measure } from "@/lib/measures";
import { createSharedCache, measuresKey } from "@/lib/measuresCache";

export type MeasuresLoad =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "unavailable" }
  | { state: "ready"; measures: Measure[]; nowSec: number };

type Fetched = { kind: "ok"; measures: Measure[] } | { kind: "unavailable" };
const cache = createSharedCache<Fetched>();

async function fetchHistory(deviceId: string, owner: boolean): Promise<Fetched> {
  const url = `/api/sensor?deviceId=${encodeURIComponent(deviceId)}${owner ? "" : "&public=1"}&hours=${MEASURE_MAX_HOURS}`;
  const r = await fetch(url, owner ? { credentials: "same-origin" } : undefined);
  if (r.status === 404 && !owner) return { kind: "unavailable" };
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  return { kind: "ok", measures: Array.isArray(j.measures) ? (j.measures as Measure[]) : [] };
}

/** `enabled` = false : aucune lecture (panneau fermé). `reload()` invalide la clé puis relit. */
export function useDeviceMeasures(deviceId: string, opts: { owner?: boolean; enabled?: boolean } = {}): MeasuresLoad & { reload: () => void } {
  const owner = opts.owner === true, enabled = opts.enabled !== false;
  const key = measuresKey(deviceId, owner);
  const [result, setResult] = useState<{ key: string; load: MeasuresLoad } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;   // un résultat reçu après démontage (ou après un changement d'appareil) est ignoré
    cache.get(key, () => fetchHistory(deviceId, owner))
      .then((f) => { if (alive) setResult({ key, load: f.kind === "unavailable" ? { state: "unavailable" } : { state: "ready", measures: f.measures, nowSec: Math.floor(Date.now() / 1000) } }); })
      .catch(() => { if (alive) setResult({ key, load: { state: "error", message: "Impossible de charger les mesures (erreur réseau ou serveur)." } }); });
    return () => { alive = false; };
  }, [key, deviceId, owner, enabled, tick]);

  const reload = useCallback(() => { cache.invalidate(key); setResult(null); setTick((t) => t + 1); }, [key]);
  const load: MeasuresLoad = result && result.key === key ? result.load : { state: "loading" };
  return { ...load, reload };
}
