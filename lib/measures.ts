// lib/measures.ts — MESURES des appareils (capteurs) : fonctions PURES (aucun accès Redis ; testées dans tests/sensor.test.ts).
//
// MODÈLE GÉNÉRIQUE (12/10/2026) : une série de mesures PAR APPAREIL (`meas:{deviceId}`), chaque mesure = un instant + une ou plusieurs GRANDEURS (temp, hum, …).
// Une carte sans écran (capteur seul) se déclare `screens = ["sensor"]` (pseudo-écran, historique) ; une carte AVEC écran peut aussi mesurer : elle déclare `sensors = ["temp", …]`
// à l'enregistrement. Ajouter une grandeur = une ligne dans MEASURE_KINDS (aucune route, aucune clé Redis à changer).
//
// Un appareil qui mesure n'est ni un écran ni un validateur seul : s'il n'a que le pseudo-écran « sensor », il n'entre ni dans devices:all (quorum), ni dans les pools d'écrans.
//
// COÛT REDIS par appareil et par POST : limite IP 2 + lecture appareil 1 + anti-rafale SET NX 1 + LPUSH/LTRIM/EXPIRE/SADD 4 = 8 commandes (la fiche n'est réécrite que toutes les 12 h).
// À 1 mesure / 30 min : 384/jour ≈ 11 500/mois et par capteur (≈ 6 % du plan de 200 k) ; l'essai à 5 min (jusqu'au 16/10, voir MEASURE_TEST_UNTIL_MS) coûtait ≈ 2 300/jour. Lecture de l'historique : 1 LRANGE ; vue réseau : 1 SMEMBERS + N LINDEX par reconstruction (≤ 1/5 min).

export const SENSOR_SCREEN = "sensor";
export const MEASURE_INDEX_KEY = "meas:devices";
export const measKey = (deviceId: string) => `meas:${deviceId}`;
export const measGateKey = (deviceId: string) => `meas:gate:${deviceId}`;

export type MeasureKind = "temp" | "hum" | "rssi" | "lat" | "dl";
/** Valeurs ENTIÈRES. scale : 10 = stockée en dixièmes d'unité (215 = 21,5 °C) ; 1 = entier tel quel. primary : affichée sur les nœuds du réseau ; sinon DIAGNOSTIC (panneaux seulement). */
export interface MeasureKindInfo { label: string; unit: string; icon: string; min: number; max: number; scale: 1 | 10; primary: boolean }
export const MEASURE_KINDS: Record<MeasureKind, MeasureKindInfo> = {
  temp: { label: "Température", unit: "°C", icon: "🌡", min: -400, max: 800, scale: 10, primary: true },
  hum:  { label: "Humidité", unit: "%", icon: "💧", min: 0, max: 1000, scale: 10, primary: true },
  // Diagnostic de la liaison Wi-Fi de la carte (dans la MÊME mesure : aucune commande Redis de plus) : puissance du signal reçu et temps de réponse du serveur
  rssi: { label: "Signal Wi-Fi", unit: "dBm", icon: "📶", min: -127, max: 0, scale: 1, primary: false },
  lat:  { label: "Latence serveur", unit: "ms", icon: "⏱", min: 0, max: 60000, scale: 1, primary: false },
  // Débit de téléchargement mesuré par la carte : durée de lecture d'un fichier STATIQUE de 4 Ko servi par le CDN (public/speedtest.bin : aucune commande Redis, aucune fonction serveur). Débit EFFECTIF de bout en bout (Internet + Wi-Fi + module + UART de la carte), pas la capacité de la box.
  dl:   { label: "Débit descendant (test 4 Ko)", unit: "kbit/s", icon: "⬇", min: 0, max: 1000000, scale: 1, primary: false },
};
export const MEASURE_KIND_IDS = Object.keys(MEASURE_KINDS) as MeasureKind[];
/** Groupes d'affichage : l'environnement (température, humidité) est SÉPARÉ de la qualité de la liaison (signal, latence, débit). */
export const MEASURE_GROUPS: { id: "env" | "link"; label: string; kinds: MeasureKind[] }[] = [
  { id: "env", label: "Température et humidité", kinds: ["temp", "hum"] },
  { id: "link", label: "Connexion de la carte", kinds: ["rssi", "lat", "dl"] },
];
/** Grandeurs d'un groupe que l'appareil mesure réellement. */
export const kindsOfGroup = (kinds: MeasureKind[], group: "env" | "link"): MeasureKind[] => kinds.filter((k) => MEASURE_GROUPS.find((g) => g.id === group)!.kinds.includes(k));
export const isMeasureKind = (k: unknown): k is MeasureKind => typeof k === "string" && Object.prototype.hasOwnProperty.call(MEASURE_KINDS, k);

// ── Cadence ──────────────────────────────────────────────────────────────────
/** Intervalle minimal entre deux ENVOIS en production : la carte lit la température toutes les 30 min (48 points/jour) mais n'ENVOIE qu'une fois par heure, deux lectures par envoi (décision du 12/10/2026 : même coût Redis qu'une mesure horaire). */
export const MEASURE_MIN_INTERVAL_SEC = 3000;
/** PHASE D'ESSAI (firmware à 1 mesure / 5 min) : intervalle minimal abaissé, avec EXTINCTION AUTOMATIQUE à cette date (règle « mode test » de CLAUDE.md). 16/10/2026 00:00 UTC. */
export const MEASURE_TEST_UNTIL_MS = Date.UTC(2026, 9, 16);
export const MEASURE_TEST_INTERVAL_SEC = 240;
export function measureMinIntervalSec(now: number = Date.now()): number {
  return now < MEASURE_TEST_UNTIL_MS ? MEASURE_TEST_INTERVAL_SEC : MEASURE_MIN_INTERVAL_SEC;
}
/** Mesures conservées par appareil : 31 jours à 1 mesure / 30 min. Les grandeurs de diagnostic (rssi, lat, dl) sont DANS la même entrée : aucune commande Redis de plus ; elles s'effacent d'elles-mêmes quand l'anneau fait le tour (pas de persistance dédiée). */
export const MEASURE_KEEP = 48 * 31;
/** Fenêtre d'historique maximale demandable à l'interface, en heures. */
export const MEASURE_MAX_HOURS = 24 * 31;
export const MEASURE_TTL_SEC = 40 * 24 * 3600;
/** Un capteur est « en ligne » s'il a mesuré depuis moins de 2 h 30 (envoi horaire, dernière lecture jusqu'à 30 min avant l'envoi). */
export const MEASURE_ONLINE_MS = 150 * 60 * 1000;
/** Lectures par envoi (la carte les met en tampon, même pendant une coupure) et âge maximal d'une lecture à l'envoi. */
export const MEASURE_BATCH_MAX = 16;
export const MEASURE_MAX_AGE_SEC = 24 * 3600;
/** Réécriture de la fiche appareil (TTL 90 j des appairés) : au plus toutes les 12 h. */
export const MEASURE_PRESENCE_REFRESH_MS = 12 * 3600 * 1000;

// ── Appareils ────────────────────────────────────────────────────────────────
/** Vrai pour une carte SANS écran (seul pseudo-écran « sensor »). */
export function isSensorScreens(screens: unknown): boolean {
  return Array.isArray(screens) && screens.length === 1 && screens[0] === SENSOR_SCREEN;
}
/**
 * Le menu « Mesures » d'un appareil AVEC écran n'apparaît que si une VRAIE mesure a été reçue (24/10/2026) : `sensors` n'est qu'une déclaration du firmware (capacité), pas la preuve qu'un capteur est branché.
 * Un capteur seul (pseudo-écran « sensor ») reste affiché dès sa déclaration. `hasMeasure` = une mesure existe pour cet appareil.
 */
export function showsMeasures(d: { screens?: unknown; sensors?: unknown }, hasMeasure: boolean): boolean {
  if (measureKindsOf(d).length === 0) return false;
  return isSensorScreens(d.screens) || hasMeasure;
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
    if (!isInt(v) || v < info.min || v > info.max) return { ok: false, error: `${k} (entier ${info.scale === 10 ? "en dixièmes, " : ""}${info.min}..${info.max}) invalide` };
    values[k] = v;
  }
  if (Object.keys(values).length === 0) return { ok: false, error: "au moins une grandeur requise" };
  return { ok: true, values };
}

export interface PostedReading { ageSec: number; values: MeasureValues }
export type ParsedBatch = { ok: true; readings: PostedReading[] } | { ok: false; error: string };

/** Corps d'un ENVOI (firmware r4dht22 >= 1.3) : `{ r: [{ a: 1800, temp: 211, hum: 719 }, { a: 0, … }], m: { rssi: -61, lat: 742, dl: 65 } }`.
 *  r = lectures en tampon (a = âge en secondes au moment de l'envoi, 0..86400, 1..16 lectures) ; m = diagnostic de la liaison, rattaché à la lecture la PLUS RÉCENTE.
 *  Les anciens corps `{ m: {…} }` / `{ c, h }` restent acceptés (une seule lecture, âge 0). */
export function parseMeasureBatch(body: unknown): ParsedBatch {
  if (!body || typeof body !== "object") return { ok: false, error: "corps invalide" };
  const b = body as Record<string, unknown>;
  if (b.r === undefined) {
    const one = parseMeasurePost(body);
    return one.ok ? { ok: true, readings: [{ ageSec: 0, values: one.values }] } : one;
  }
  if (!Array.isArray(b.r) || b.r.length < 1 || b.r.length > MEASURE_BATCH_MAX) return { ok: false, error: `r : 1 à ${MEASURE_BATCH_MAX} lectures requises` };
  const readings: PostedReading[] = [];
  for (const item of b.r) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: "lecture invalide" };
    const { a, ...rest } = item as Record<string, unknown>;
    if (!isInt(a) || a < 0 || a > MEASURE_MAX_AGE_SEC) return { ok: false, error: `a (âge en secondes, 0..${MEASURE_MAX_AGE_SEC}) invalide` };
    const p = parseMeasurePost({ m: rest });
    if (!p.ok) return p;
    readings.push({ ageSec: a, values: p.values });
  }
  if (b.m !== undefined) {
    const d = parseMeasurePost({ m: b.m });
    if (!d.ok) return d;
    let youngest = readings[0];
    for (const r of readings) if (r.ageSec < youngest.ageSec) youngest = r;
    youngest.values = { ...youngest.values, ...d.values };
  }
  return { ok: true, readings };
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
export function formatMeasure(kind: MeasureKind, stored: number): string {
  const info = MEASURE_KINDS[kind];
  if (kind === "dl" && stored >= 1000) return `${(stored / 1000).toFixed(1).replace(".", ",")} Mbit/s`;
  return info.scale === 10 ? `${(stored / 10).toFixed(1).replace(".", ",")} ${info.unit}` : `${stored} ${info.unit}`;
}
/** Grandeurs affichées sur les nœuds du réseau (les grandeurs de diagnostic restent dans les panneaux). */
export const primaryKinds = (kinds: MeasureKind[]): MeasureKind[] => kinds.filter((k) => MEASURE_KINDS[k].primary);

/** Nombre d'heures demandé par l'interface : entier borné à [1, MEASURE_MAX_HOURS], 168 (7 jours) par défaut. */
export function clampHours(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MEASURE_MAX_HOURS) : 168;
}

/** Résumé PUBLIC d'un appareil pour la vue réseau : dernière mesure (aucun historique). */
export interface DeviceMeasures { kinds: MeasureKind[]; latest: Measure | null }
export function toDeviceMeasures(kinds: MeasureKind[], latestRaw: unknown): DeviceMeasures {
  return { kinds, latest: decodeMeasure(latestRaw) };
}
