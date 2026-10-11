// lib/measures.ts — MESURES des appareils (capteurs) : fonctions PURES (aucun accès Redis ; testées dans tests/sensor.test.ts).
//
// MODÈLE GÉNÉRIQUE (12/10/2026) : une série de mesures PAR APPAREIL (`meas:{deviceId}`), chaque mesure = un instant + une ou plusieurs GRANDEURS (temp, hum, …).
// Une carte sans écran (capteur seul) se déclare `screens = ["sensor"]` (pseudo-écran, historique) ; une carte AVEC écran peut aussi mesurer : elle déclare `sensors = ["temp", …]`
// à l'enregistrement. Ajouter une grandeur = une ligne dans MEASURE_KINDS (aucune route, aucune clé Redis à changer).
//
// Un appareil qui mesure n'est ni un écran ni un validateur seul : s'il n'a que le pseudo-écran « sensor », il n'entre ni dans devices:all (quorum), ni dans les pools d'écrans.
//
// COÛT REDIS par appareil et par POST : limite IP 2 + lecture appareil 1 + anti-rafale SET NX 1 + LPUSH/LTRIM/EXPIRE/SADD 4 = 8 commandes (la fiche n'est réécrite que toutes les 12 h).
// À 1 mesure/h : 192/jour ≈ 5 800/mois ; en PHASE D'ESSAI (1 mesure/5 min, voir MEASURE_TEST_UNTIL_MS) : ≈ 2 300/jour (≈ 7 000 pour l'essai jusqu'au 16/10). Lecture de l'historique : 1 LRANGE ; vue réseau : 1 SMEMBERS + N LINDEX par reconstruction (≤ 1/5 min).

export const SENSOR_SCREEN = "sensor";
export const MEASURE_INDEX_KEY = "meas:devices";
export const measKey = (deviceId: string) => `meas:${deviceId}`;
export const measGateKey = (deviceId: string) => `meas:gate:${deviceId}`;

export type MeasureKind = "temp" | "hum";
export interface MeasureKindInfo { label: string; unit: string; icon: string; min: number; max: number }
/** Valeurs ENTIÈRES en dixièmes d'unité (215 = 21,5 °C ; 456 = 45,6 %). */
export const MEASURE_KINDS: Record<MeasureKind, MeasureKindInfo> = {
  temp: { label: "Température", unit: "°C", icon: "🌡", min: -400, max: 800 },
  hum:  { label: "Humidité", unit: "%", icon: "💧", min: 0, max: 1000 },
};
export const MEASURE_KIND_IDS = Object.keys(MEASURE_KINDS) as MeasureKind[];
export const isMeasureKind = (k: unknown): k is MeasureKind => typeof k === "string" && Object.prototype.hasOwnProperty.call(MEASURE_KINDS, k);

// ── Cadence ──────────────────────────────────────────────────────────────────
/** Intervalle minimal accepté en production : le firmware poste 1 mesure/h. */
export const MEASURE_MIN_INTERVAL_SEC = 3000;
/** PHASE D'ESSAI (firmware à 1 mesure / 5 min) : intervalle minimal abaissé, avec EXTINCTION AUTOMATIQUE à cette date (règle « mode test » de CLAUDE.md). 16/10/2026 00:00 UTC. */
export const MEASURE_TEST_UNTIL_MS = Date.UTC(2026, 9, 16);
export const MEASURE_TEST_INTERVAL_SEC = 240;
export function measureMinIntervalSec(now: number = Date.now()): number {
  return now < MEASURE_TEST_UNTIL_MS ? MEASURE_TEST_INTERVAL_SEC : MEASURE_MIN_INTERVAL_SEC;
}
/** Mesures conservées par appareil (31 jours à 1/h ; ≈ 62 h pendant l'essai à 5 min). */
export const MEASURE_KEEP = 24 * 31;
export const MEASURE_TTL_SEC = 40 * 24 * 3600;
/** Un capteur est « en ligne » s'il a mesuré depuis moins de 2 h 30 (au moins deux cadences horaires manquées pour l'en retirer). */
export const MEASURE_ONLINE_MS = 150 * 60 * 1000;
/** Réécriture de la fiche appareil (TTL 90 j des appairés) : au plus toutes les 12 h. */
export const MEASURE_PRESENCE_REFRESH_MS = 12 * 3600 * 1000;

// ── Appareils ────────────────────────────────────────────────────────────────
/** Vrai pour une carte SANS écran (seul pseudo-écran « sensor »). */
export function isSensorScreens(screens: unknown): boolean {
  return Array.isArray(screens) && screens.length === 1 && screens[0] === SENSOR_SCREEN;
}
/** Grandeurs mesurées par un appareil : `sensors` déclarées (filtrées), à défaut temp + hum pour un capteur historique « sensor ». */
export function measureKindsOf(d: { screens?: unknown; sensors?: unknown }): MeasureKind[] {
  if (Array.isArray(d.sensors)) {
    const ks = d.sensors.filter(isMeasureKind);
    return [...new Set(ks)];
  }
  return isSensorScreens(d.screens) ? ["temp", "hum"] : [];
}
/** Déclaration reçue à l'enregistrement : tableau de grandeurs connues (les inconnues sont ignorées), ou undefined. */
export function parseDeclaredSensors(raw: unknown): MeasureKind[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return [...new Set(raw.filter(isMeasureKind))];
}

// ── Mesures ──────────────────────────────────────────────────────────────────
export type MeasureValues = Partial<Record<MeasureKind, number>>;
export interface Measure { t: number; v: MeasureValues }   // t = secondes Unix (horloge du SERVEUR : les cartes n'ont pas d'horloge)

export type ParsedPost = { ok: true; values: MeasureValues } | { ok: false; error: string };
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Corps d'un POST : `{ m: { temp: 215, hum: 456 } }` ou, pour le firmware r4dht22-1.0 déjà déployé, `{ c, h }`. Entiers dans les plages de MEASURE_KINDS ; au moins une grandeur ; grandeur inconnue = refus. */
export function parseMeasurePost(body: unknown): ParsedPost {
  if (!body || typeof body !== "object") return { ok: false, error: "corps invalide" };
  const b = body as Record<string, unknown>;
  const raw: Record<string, unknown> = {};
  if (b.m !== undefined) {
    if (!b.m || typeof b.m !== "object" || Array.isArray(b.m)) return { ok: false, error: "m doit être un objet" };
    Object.assign(raw, b.m);
  }
  if (b.c !== undefined && raw.temp === undefined) raw.temp = b.c;
  if (b.h !== undefined && b.h !== null && raw.hum === undefined) raw.hum = b.h;
  const values: MeasureValues = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    if (!isMeasureKind(k)) return { ok: false, error: `grandeur inconnue : ${k}` };
    const info = MEASURE_KINDS[k];
    if (!isInt(v) || v < info.min || v > info.max) return { ok: false, error: `${k} (entier en dixièmes, ${info.min}..${info.max}) invalide` };
    values[k] = v;
  }
  if (Object.keys(values).length === 0) return { ok: false, error: "au moins une grandeur requise" };
  return { ok: true, values };
}

/** « t;temp=215;hum=456 » (≈ 25 o) — grandeurs triées. */
export function encodeMeasure(m: Measure): string {
  const parts = MEASURE_KIND_IDS.filter((k) => m.v[k] !== undefined).map((k) => `${k}=${m.v[k]}`);
  return [String(m.t), ...parts].join(";");
}
export function decodeMeasure(raw: unknown): Measure | null {
  if (typeof raw !== "string") return null;
  const [ts, ...rest] = raw.split(";");
  const t = Number(ts);
  if (!Number.isInteger(t) || t <= 0 || rest.length === 0) return null;
  const v: MeasureValues = {};
  for (const part of rest) {
    const i = part.indexOf("=");
    if (i < 1) return null;
    const k = part.slice(0, i), n = Number(part.slice(i + 1));
    if (!isMeasureKind(k) || !Number.isInteger(n)) return null;
    v[k] = n;
  }
  return { t, v };
}
/** Du plus récent au plus ancien (ordre LPUSH) ; les entrées illisibles sont ignorées. */
export function decodeMeasures(raws: unknown[]): Measure[] {
  const out: Measure[] = [];
  for (const r of raws) { const d = decodeMeasure(r); if (d) out.push(d); }
  return out;
}

export interface MeasureSummary { count: number; min: number | null; max: number | null; avg: number | null; last: Measure | null }
/** Résumé d'UNE grandeur (dixièmes ; moyenne arrondie au dixième). `last` = la mesure la plus récente qui porte cette grandeur. */
export function summarize(measures: Measure[], kind: MeasureKind): MeasureSummary {
  const own = measures.filter((m) => m.v[kind] !== undefined);
  if (own.length === 0) return { count: 0, min: null, max: null, avg: null, last: null };
  let min = Infinity, max = -Infinity, sum = 0, last = own[0];
  for (const m of own) { const x = m.v[kind] as number; if (x < min) min = x; if (x > max) max = x; sum += x; if (m.t > last.t) last = m; }
  return { count: own.length, min, max, avg: Math.round(sum / own.length), last };
}

/** « 21,5 °C » depuis des dixièmes. */
export function formatMeasure(kind: MeasureKind, tenths: number): string {
  const info = MEASURE_KINDS[kind];
  return `${(tenths / 10).toFixed(1).replace(".", ",")} ${info.unit}`;
}

/** Nombre d'heures demandé par l'interface : entier borné à [1, MEASURE_KEEP], 168 (7 jours) par défaut. */
export function clampHours(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MEASURE_KEEP) : 168;
}

/** Résumé PUBLIC d'un appareil pour la vue réseau : dernière mesure (aucun historique). */
export interface DeviceMeasures { kinds: MeasureKind[]; latest: Measure | null }
export function toDeviceMeasures(kinds: MeasureKind[], latestRaw: unknown): DeviceMeasures {
  return { kinds, latest: decodeMeasure(latestRaw) };
}
